import { describe, expect, it } from 'vitest'
import { ACTION_LATENCY, createFleetEngine, metricState, RemoteActionError } from './fleet-engine'

const START = 1_800_000_000_000

function engineWithFault() {
  const engine = createFleetEngine({ seed: 7, now: START, initialFaults: [['kao-0001', 'tire-fl']], faultInterval: [9e9, 9e9] })
  engine.tick(START + 1000)
  return engine
}

const g80 = (engine: ReturnType<typeof createFleetEngine>) => engine.frame().vehicles.find((v) => v.id === 'kao-0001')!

describe('metricState', () => {
  it('높을수록 나쁜 지표는 기준 이상에서 경고·위험이 됩니다', () => {
    const spec = { warn: 105, crit: 115, direction: 'high' as const }
    expect(metricState(spec, 100)).toBe('nominal')
    expect(metricState(spec, 105)).toBe('warning')
    expect(metricState(spec, 120)).toBe('critical')
  })

  it('낮을수록 나쁜 지표는 기준 이하에서 경고·위험이 됩니다', () => {
    const spec = { warn: 220, crit: 200, direction: 'low' as const }
    expect(metricState(spec, 250)).toBe('nominal')
    expect(metricState(spec, 210)).toBe('warning')
    expect(metricState(spec, 190)).toBe('critical')
  })
})

describe('createFleetEngine', () => {
  it('등록 탈것 4대의 프레임을 만들고 시간이 지나면 위치가 앞으로 갑니다', () => {
    const engine = createFleetEngine({ seed: 1, now: START, faultInterval: [9e9, 9e9] })
    engine.tick(START + 500)
    const before = engine.frame().vehicles.map((v) => v.progress + v.lap)
    engine.tick(START + 10_500)
    const after = engine.frame().vehicles.map((v) => v.progress + v.lap)
    expect(after).toHaveLength(4)
    after.forEach((value, index) => expect(value).toBeGreaterThan(before[index]!))
  })

  it('미리 걸어 둔 문제는 경고 이상의 열린 문제로 나타납니다', () => {
    const vehicle = g80(engineWithFault())
    const issue = vehicle.issues[0]!
    expect(issue.metricKey).toBe('tire-fl')
    expect(issue.status).toBe('open')
    expect(vehicle.health).not.toBe('nominal')
  })

  it('원격 조치를 보내면 조치 중이 되고, 응답 시간이 지나면 해결됩니다', () => {
    const engine = engineWithFault()
    const issue = g80(engine).issues[0]!
    const response = engine.applyAction('kao-0001', { issueId: issue.id, action: 'speed-limit' }, START + 2000)
    expect(response.entry.phase).toBe('sent')
    expect(response.vehicle.issues[0]!.status).toBe('resolving')
    expect(response.vehicle.speedCap).toBe(80)

    engine.tick(START + 2000 + ACTION_LATENCY + 500)
    const resolved = g80(engine).issues.find((item) => item.id === issue.id)!
    expect(resolved.status).toBe('resolved')
    expect(resolved.resolvedBy).toBe('speed-limit')
    expect(engine.frame().log[0]!.phase).toBe('completed')
  })

  it('같은 문제에 두 번 보내면 409, 맞지 않는 조치는 422로 거절합니다', () => {
    const engine = engineWithFault()
    const issue = g80(engine).issues[0]!
    expect(() => engine.applyAction('kao-0001', { issueId: issue.id, action: 'cooling-mode' }, START + 1500)).toThrowError(
      expect.objectContaining({ statusCode: 422 }),
    )
    engine.applyAction('kao-0001', { issueId: issue.id, action: 'tpms-recalibrate' }, START + 2000)
    try {
      engine.applyAction('kao-0001', { issueId: issue.id, action: 'tpms-recalibrate' }, START + 2100)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(RemoteActionError)
      expect((error as RemoteActionError).statusCode).toBe(409)
    }
  })

  it('없는 탈것이나 문제는 404로 거절합니다', () => {
    const engine = engineWithFault()
    expect(() => engine.applyAction('nope', { issueId: 'x', action: 'notify-rider' })).toThrowError(
      expect.objectContaining({ statusCode: 404 }),
    )
  })
})
