import { describe, expect, it } from 'vitest'
import { ACTION_LATENCY, checkAction, computeFrame, computeHistory, dayStartOf, metricState, SPEED_CAP_DURATION } from './engine'
import type { ActionRecord } from './engine'

const DAY = dayStartOf(Date.UTC(2026, 10, 12, 3))

/** 하루 중 열린 문제가 처음 보이는 시각을 찾습니다. */
function firstOpenIssue(actions: ActionRecord[] = []) {
  for (let t = DAY + 60_000; t < DAY + 6 * 3600_000; t += 15_000) {
    for (const vehicle of computeFrame({ now: t, actions }).vehicles) {
      const issue = vehicle.issues.find((item) => item.status === 'open')
      if (issue) return { now: t, vehicle, issue }
    }
  }
  throw new Error('열린 문제가 없습니다')
}

describe('metricState', () => {
  it('높을수록·낮을수록 나쁜 지표의 경고·위험을 가립니다', () => {
    expect(metricState({ warn: 105, crit: 115, direction: 'high' }, 110)).toBe('warning')
    expect(metricState({ warn: 220, crit: 200, direction: 'low' }, 190)).toBe('critical')
    expect(metricState({ warn: 220, crit: 200, direction: 'low' }, 250)).toBe('nominal')
  })
})

describe('computeFrame', () => {
  it('같은 시각과 기록이면 어느 서버에서든 같은 프레임을 냅니다', () => {
    const now = DAY + 3 * 3600_000 + 1234
    expect(computeFrame({ now, actions: [] })).toEqual(computeFrame({ now, actions: [] }))
  })

  it('시간이 지나면 위치가 앞으로 가고, 볼 수 있는 탈것만 돌려줍니다', () => {
    const now = DAY + 3600_000
    const before = computeFrame({ now, actions: [] }).vehicles
    const after = computeFrame({ now: now + 10_000, actions: [] }).vehicles
    after.forEach((vehicle, i) => expect(vehicle.lap + vehicle.progress).toBeGreaterThan(before[i]!.lap + before[i]!.progress))
    expect(computeFrame({ now, actions: [], vehicleIds: ['kao-0002'] }).vehicles.map((v) => v.id)).toEqual(['kao-0002'])
  })

  it('하루 중 문제가 생기고 동시에 3건을 넘지 않습니다', () => {
    let seen = 0
    for (let t = DAY; t < DAY + 6 * 3600_000; t += 60_000) {
      const active = computeFrame({ now: t, actions: [] }).vehicles.flatMap((v) => v.issues).filter((i) => i.status !== 'resolved')
      expect(active.length).toBeLessThanOrEqual(3)
      seen += active.length
    }
    expect(seen).toBeGreaterThan(0)
  })
})

describe('원격 조치', () => {
  it('열린 문제에 조치를 보내면 조치 중을 거쳐 해결되고, 속도 제한이 걸립니다', () => {
    const { now, vehicle, issue } = firstOpenIssue()
    const action = issue.actions.includes('speed-limit') ? 'speed-limit' : issue.actions[0]!
    expect(checkAction(now, [], vehicle.id, issue.id, action)).toMatchObject({ ok: true })

    const record: ActionRecord = { id: 'a1', issueId: issue.id, vehicleId: vehicle.id, action, sentAt: now }
    const during = computeFrame({ now: now + 500, actions: [record], vehicleIds: [vehicle.id] }).vehicles[0]!
    expect(during.issues.find((i) => i.id === issue.id)!.status).toBe('resolving')

    const after = computeFrame({ now: now + ACTION_LATENCY + 100, actions: [record], vehicleIds: [vehicle.id] })
    const resolved = after.vehicles[0]!.issues.find((i) => i.id === issue.id)!
    expect(resolved).toMatchObject({ status: 'resolved', resolvedBy: action })
    expect(after.log.map((entry) => entry.phase)).toEqual(['completed', 'sent'])
    if (action === 'speed-limit') {
      expect(after.vehicles[0]!.speedCap).not.toBeNull()
      const later = computeFrame({ now: now + SPEED_CAP_DURATION + 1000, actions: [record], vehicleIds: [vehicle.id] })
      expect(later.vehicles[0]!.speedCap).toBeNull()
    }
  })

  it('이미 조치한 문제는 409, 맞지 않는 조치는 422, 없는 탈것은 404로 거절합니다', () => {
    const { now, vehicle, issue } = firstOpenIssue()
    const record: ActionRecord = { id: 'a1', issueId: issue.id, vehicleId: vehicle.id, action: issue.actions[0]!, sentAt: now }
    expect(checkAction(now + 100, [record], vehicle.id, issue.id, issue.actions[0]!)).toMatchObject({ ok: false, statusCode: 409 })
    const wrong = (['cooling-mode', 'eco-power', 'traction-boost'] as const).find((code) => !issue.actions.includes(code))!
    expect(checkAction(now, [], vehicle.id, issue.id, wrong)).toMatchObject({ ok: false, statusCode: 422 })
    expect(checkAction(now, [], 'nope', issue.id, 'notify-rider')).toMatchObject({ ok: false, statusCode: 404 })
  })
})

describe('computeHistory', () => {
  it('지난 시각을 다시 계산하며, 마지막 값은 그 시각의 프레임과 같습니다', () => {
    const to = DAY + 2 * 3600_000
    const history = computeHistory({ vehicleId: 'kao-0001', metricKey: 'coolant', from: to - 600_000, to, points: 60, actions: [] })!
    expect(history.samples).toHaveLength(60)
    const frame = computeFrame({ now: to, actions: [], vehicleIds: ['kao-0001'] })
    expect(history.samples.at(-1)!.value).toBe(frame.vehicles[0]!.metrics.find((m) => m.key === 'coolant')!.value)
    expect(computeHistory({ vehicleId: 'kao-0001', metricKey: 'nope', from: 0, to: 1, points: 2, actions: [] })).toBeNull()
  })
})
