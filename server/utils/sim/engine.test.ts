import { describe, expect, it } from 'vitest'
import { findRoute } from '../../../src/shared/config/routes'
import { createRouteGeo, turnRateAt } from '../../../src/shared/lib/route-geo'
import { VEHICLE_SPECS } from '../fleet-specs'
import { ACTION_LATENCY, checkAction, computeFrame, computeHistory, criticalIssues, dayStartOf, metricState, SPEED_CAP_DURATION, TIME_SCALE } from './engine'
import type { ActionRecord, LiveIssueRecord, LiveReading } from './engine'
import { ACK_TIMEOUT, liveIssueId } from './live'

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

  it('시간이 지나면 위치가 뒤로 가지 않고(신호에서는 멈춤) 2분이면 앞으로 가며, 볼 수 있는 탈것만 돌려줍니다', () => {
    const now = DAY + 3600_000
    const before = computeFrame({ now, actions: [] }).vehicles
    const soon = computeFrame({ now: now + 10_000, actions: [] }).vehicles
    const later = computeFrame({ now: now + 120_000, actions: [] }).vehicles
    soon.forEach((vehicle, i) => expect(vehicle.lap + vehicle.progress).toBeGreaterThanOrEqual(before[i]!.lap + before[i]!.progress))
    later.forEach((vehicle, i) => expect(vehicle.lap + vehicle.progress).toBeGreaterThan(before[i]!.lap + before[i]!.progress))
    expect(computeFrame({ now, actions: [], vehicleIds: ['kao-0002'] }).vehicles.map((v) => v.id)).toEqual(['kao-0002'])
  })

  it('바퀴 수는 실제 속도 기준이라 정각부터 한 시간 동안 최고 속도로 달려도 넘을 수 없는 값이 나오지 않습니다', () => {
    const hourStart = DAY + 5 * 3600_000
    const frame = computeFrame({ now: hourStart + 59 * 60_000, actions: [] })
    for (const vehicle of frame.vehicles) {
      const spec = VEHICLE_SPECS.find((item) => item.id === vehicle.id)!
      const maxLaps = Math.ceil(spec.cruise[1] / findRoute(spec.routeId).lengthKm)
      expect(vehicle.lap, vehicle.id).toBeGreaterThanOrEqual(1)
      expect(vehicle.lap, vehicle.id).toBeLessThanOrEqual(maxLaps + 1)
    }
    // 정각이 되면 1바퀴째부터 다시 셉니다.
    expect(computeFrame({ now: hourStart + 3600_000, actions: [] }).vehicles.every((vehicle) => vehicle.lap === 1)).toBe(true)
  })

  it('실제 위치는 실제 속도로, 지도 위치는 지도 속도(mapSpeed)의 TIME_SCALE배로 움직입니다', () => {
    const step = 200
    for (let now = DAY + 7 * 3600_000; now < DAY + 7 * 3600_000 + 600_000; now += 61_000) {
      const a = computeFrame({ now, actions: [] }).vehicles
      const b = computeFrame({ now: now + step, actions: [] }).vehicles
      a.forEach((vehicle, i) => {
        const meters = findRoute(vehicle.routeId).lengthKm * 1000
        const moved = (from: number, to: number) => ((to - from + 1) % 1) * meters
        const expectMoved = (actual: number, speed: number, label: string) => {
          const expected = (speed / 3.6) * (step / 1000)
          expect(Math.abs(actual - expected), `${vehicle.id} ${label}`).toBeLessThanOrEqual(expected * 0.15 + 0.1)
        }
        expectMoved(moved(vehicle.progress, b[i]!.progress), (vehicle.speed + b[i]!.speed) / 2, 'real')
        expectMoved(moved(vehicle.mapProgress, b[i]!.mapProgress) / TIME_SCALE, (vehicle.mapSpeed + b[i]!.mapSpeed) / 2, 'map')
      })
    }
  })

  it('하루 중 문제가 생기고 동시에 2건을 넘지 않습니다', () => {
    let seen = 0
    for (let t = DAY; t < DAY + 6 * 3600_000; t += 60_000) {
      const active = computeFrame({ now: t, actions: [] }).vehicles.flatMap((v) => v.issues).filter((i) => i.status !== 'resolved')
      expect(active.length).toBeLessThanOrEqual(2)
      seen += active.length
    }
    expect(seen).toBeGreaterThan(0)
  })
})

describe('실차 신호', () => {
  it('30초 안에 측정값이 들어온 탈것은 시뮬레이션 문제 없이 실측 지표로 상태를 정합니다', () => {
    const { now, vehicle } = firstOpenIssue()
    const readings = [{ vehicleId: vehicle.id, at: now - 1000, speed: 40, metrics: {} }]
    const live = computeFrame({ now, actions: [], readings, vehicleIds: [vehicle.id] }).vehicles[0]!
    expect(live.source).toBe('live')
    expect(live.issues).toEqual([])
    expect(live.speed).toBe(40)
    const stale = computeFrame({ now: now + 31_000, actions: [], readings, vehicleIds: [vehicle.id] }).vehicles[0]!
    expect(stale.source).toBe('simulated')
  })

  const now = DAY + 3 * 3600_000 + 600_000
  const issueId = liveIssueId('kao-0001', 'coolant', now - 60_000)
  const record: LiveIssueRecord = {
    id: issueId,
    vehicleId: 'kao-0001',
    metricKey: 'coolant',
    severity: 'critical',
    detectedAt: now - 60_000,
    clearedAt: null,
    resolvedAt: null,
    checkedAt: now - 2000,
  }
  const hot: LiveReading[] = [{ vehicleId: 'kao-0001', at: now - 2000, speed: 55, metrics: { coolant: 117.4 } }]

  it('실차 신호가 있는 동안 실측 문제를 보여 주고 상태에 반영하며, 위험 등급이면 알림 대상입니다', () => {
    const vehicle = computeFrame({ now, actions: [], readings: hot, liveIssues: [record], vehicleIds: ['kao-0001'] }).vehicles[0]!
    expect(vehicle.issues).toEqual([expect.objectContaining({ id: issueId, source: 'live', status: 'open', severity: 'critical' })])
    expect(vehicle.health).toBe('critical')
    expect(vehicle.metrics.find((metric) => metric.key === 'coolant')).toMatchObject({ value: 117.4, state: 'critical' })
    expect(criticalIssues({ now, actions: [], readings: hot, liveIssues: [record] }).map(({ issue }) => issue.id)).toContain(issueId)
    // 신호가 끊기면 시뮬레이션으로 돌아가고 실측 문제는 숨깁니다.
    const offline = computeFrame({ now: now + 40_000, actions: [], readings: hot, liveIssues: [record], vehicleIds: ['kao-0001'] }).vehicles[0]!
    expect(offline.issues.some((issue) => issue.id === issueId)).toBe(false)
  })

  it('실측 문제에 보낸 명령은 차량 응답을 기다리고, 응답이 없으면 실패로 기록하고 다시 보낼 수 있습니다', () => {
    const input = { now, actions: [], readings: hot, liveIssues: [record] }
    expect(checkAction(input, 'kao-0001', issueId, 'cooling-mode')).toMatchObject({ ok: true })
    const sent: ActionRecord = { id: 'c1', issueId, vehicleId: 'kao-0001', action: 'cooling-mode', sentAt: now }
    const waiting = { ...input, now: now + 1000, actions: [sent] }
    expect(computeFrame(waiting).vehicles[0]!.issues[0]).toMatchObject({ status: 'resolving', stage: 'awaiting' })
    expect(checkAction(waiting, 'kao-0001', issueId, 'power-limit')).toMatchObject({ ok: false, statusCode: 409 })
    // 시뮬레이션처럼 정해진 시간 뒤에 저절로 '완료'되지 않습니다.
    expect(computeFrame({ ...waiting, now: now + ACTION_LATENCY + 1000 }).log.map((entry) => entry.phase)).toEqual(['sent'])

    const late = { ...input, now: now + ACK_TIMEOUT + 1000, readings: [{ ...hot[0]!, at: now + ACK_TIMEOUT }], actions: [sent] }
    const frame = computeFrame(late)
    expect(frame.vehicles[0]!.issues[0]!.status).toBe('open')
    expect(frame.log[0]).toMatchObject({ phase: 'failed', message: 'G80 · 냉각수 과열: 냉각 모드 명령에 2분 동안 차량 응답 없음' })
    expect(checkAction(late, 'kao-0001', issueId, 'power-limit')).toMatchObject({ ok: true })
  })

  it('차량이 속도 제한을 적용하면 제한을 보여 주고, 시뮬레이션 위치·문제 일정은 실차 명령의 영향을 받지 않습니다', () => {
    const applied: ActionRecord = {
      id: 'c1', issueId, vehicleId: 'kao-0001', action: 'speed-limit', sentAt: now - 5000,
      ack: { at: now - 3000, result: 'applied', message: null },
    }
    const live = computeFrame({ now, actions: [applied], readings: hot, liveIssues: [record], vehicleIds: ['kao-0001'] }).vehicles[0]!
    // 속도 제한은 평소 최고 속도(G80 50km/h)의 60%
    expect(live.speedCap).toBe(30)
    const simulated = computeFrame({ now: now + 60_000, actions: [applied], vehicleIds: ['kao-0001'] }).vehicles[0]!
    const plain = computeFrame({ now: now + 60_000, actions: [], vehicleIds: ['kao-0001'] }).vehicles[0]!
    expect(simulated).toEqual(plain)
  })

  it('0시 직전에 보낸 명령도 0시가 지나면 계속 차량 응답을 기다리고, 조치 기록은 오늘 것만 보여 줍니다', () => {
    const midnight = dayStartOf(now) + 86_400_000
    const lateIssue = { ...record, id: liveIssueId('kao-0001', 'coolant', midnight - 90_000), detectedAt: midnight - 90_000 }
    const sent: ActionRecord = { id: 'c1', issueId: lateIssue.id, vehicleId: 'kao-0001', action: 'cooling-mode', sentAt: midnight - 60_000 }
    const after = computeFrame({
      now: midnight + 30_000,
      actions: [sent],
      readings: [{ ...hot[0]!, at: midnight + 29_000 }],
      liveIssues: [lateIssue],
      vehicleIds: ['kao-0001'],
    })
    expect(after.vehicles[0]!.issues[0]).toMatchObject({ status: 'resolving', stage: 'awaiting' })
    expect(after.log).toEqual([])
  })

  it('GPS가 경로 위에 있으면 그 위치를 쓰고, 벗어나 있으면 시뮬레이션 위치를 씁니다', () => {
    const position = { lat: 37.5665, lng: 126.978, progress: 0.4321, odometer: 2.4321 }
    const onRoute = computeFrame({ now, actions: [], readings: [{ ...hot[0]!, position }], vehicleIds: ['kao-0001'] }).vehicles[0]!
    expect(onRoute).toMatchObject({ positionSource: 'gps', progress: 0.4321, mapProgress: 0.4321, lap: 3 })
    expect(onRoute.gps).toEqual({ lat: 37.5665, lng: 126.978, at: now - 2000, onRoute: true, trail: [[37.5665, 126.978]] })
    const off = computeFrame({ now, actions: [], readings: [{ ...hot[0]!, position: { ...position, progress: null } }], vehicleIds: ['kao-0001'] }).vehicles[0]!
    const simulated = computeFrame({ now, actions: [], vehicleIds: ['kao-0001'] }).vehicles[0]!
    expect(off).toMatchObject({ positionSource: 'simulated', progress: simulated.progress, gps: { onRoute: false } })
  })

  it('GPS 궤적은 최근 2분의 위치를 오래된 것부터 담습니다(관제 지도가 경로 밖 실차의 지나온 길을 그림)', () => {
    const at = (ms: number, lat: number): LiveReading => ({
      ...hot[0]!,
      at: now - ms,
      position: { lat, lng: 127.05, progress: null, odometer: 0 },
    })
    const readings = [at(1000, 37.503), at(150_000, 37.5), at(60_000, 37.502), at(90_000, 37.501)]
    const vehicle = computeFrame({ now, actions: [], readings, vehicleIds: ['kao-0001'] }).vehicles[0]!
    expect(vehicle.gps).toMatchObject({ lat: 37.503, onRoute: false })
    expect(vehicle.gps!.trail).toEqual([
      [37.501, 127.05],
      [37.502, 127.05],
      [37.503, 127.05],
    ])
  })
})

describe('원격 조치', () => {
  it('열린 문제에 조치를 보내면 조치 중을 거쳐 해결되고, 속도 제한이 걸립니다', () => {
    const { now, vehicle, issue } = firstOpenIssue()
    const action = issue.actions.includes('speed-limit') ? 'speed-limit' : issue.actions[0]!
    expect(checkAction({ now, actions: [] }, vehicle.id, issue.id, action)).toMatchObject({ ok: true })

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
    expect(checkAction({ now: now + 100, actions: [record] }, vehicle.id, issue.id, issue.actions[0]!)).toMatchObject({ ok: false, statusCode: 409 })
    const wrong = (['cooling-mode', 'eco-power', 'traction-boost'] as const).find((code) => !issue.actions.includes(code))!
    expect(checkAction({ now, actions: [] }, vehicle.id, issue.id, wrong)).toMatchObject({ ok: false, statusCode: 422 })
    expect(checkAction({ now, actions: [] }, 'nope', issue.id, 'notify-rider')).toMatchObject({ ok: false, statusCode: 404 })
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

  it('실차 측정값이 있던 시각은 그 값을 쓰고 몇 점이 실측인지 셉니다', () => {
    const to = DAY + 2 * 3600_000
    const from = to - 600_000
    // 마지막 2분만 실차가 10초마다 보냈습니다.
    const readings: LiveReading[] = []
    for (let at = to - 120_000; at <= to; at += 10_000) readings.push({ vehicleId: 'kao-0001', at, metrics: { coolant: 101.5 } })
    const history = computeHistory({ vehicleId: 'kao-0001', metricKey: 'coolant', from, to, points: 61, actions: [], readings })!
    const live = history.samples.filter((sample) => sample.at >= to - 120_000)
    expect(live.every((sample) => sample.value === 101.5)).toBe(true)
    expect(history.liveSamples).toBe(live.length)
    expect(history.samples[0]!.value).not.toBe(101.5)
  })
})

describe('도로에 맞는 속도와 기울기', () => {
  /** 위치(한 바퀴 비율)의 제한속도(routes.ts의 구간별 제한속도) */
  const limitAt = (routeId: string, at: number) => {
    const zones = findRoute(routeId).speedLimits
    return [...zones].reverse().find(([from]) => from <= ((at % 1) + 1) % 1)?.[1] ?? zones[0]![1]
  }
  /** 한 시간 동안 7초 간격으로 본 프레임 */
  const hour = (id: string) =>
    Array.from({ length: Math.floor(3600 / 7) }, (_, i) => computeFrame({ now: DAY + 4 * 3600_000 + i * 7000, actions: [], vehicleIds: [id] }).vehicles[0]!)

  it('속도는 그 위치의 제한속도와 탈것 최고 속도를 넘지 않습니다(구간이 바뀌는 곳은 감속 중이라 15m 앞까지 봄)', () => {
    for (const spec of VEHICLE_SPECS) {
      const meters = findRoute(spec.routeId).lengthKm * 1000
      for (const vehicle of hour(spec.id)) {
        const limit = Math.max(limitAt(spec.routeId, vehicle.progress), limitAt(spec.routeId, vehicle.progress - 15 / meters))
        expect(vehicle.speed, `${spec.id} ${vehicle.progress}`).toBeLessThanOrEqual(Math.min(limit, spec.cruise[1]) + 0.1)
        expect(vehicle.speed).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('신호가 있는 도심·남산 경로에서는 신호에서 서고, 강변북로·올림픽대로에서는 시속 64km 넘게 달립니다', () => {
    for (const id of ['kao-0001', 'kao-0003']) {
      const stopped = hour(id).filter((vehicle) => vehicle.speed < 1)
      expect(stopped.length, id).toBeGreaterThan(5)
    }
    const aventador = hour('kao-0002')
    expect(Math.max(...aventador.map((vehicle) => vehicle.speed))).toBeGreaterThan(64)
    expect(aventador.every((vehicle) => vehicle.speed > 0)).toBe(true)
  })

  it('속도 제한이 걸린 동안에도 지도 위치는 지도 속도(mapSpeed)의 TIME_SCALE배로 움직입니다', () => {
    const sentAt = DAY + 4 * 3600_000
    const capped: ActionRecord = { id: 'cap', issueId: 'x', vehicleId: 'kao-0002', action: 'speed-limit', sentAt }
    const meters = findRoute('han-river').lengthKm * 1000
    for (let t = sentAt + 3000; t < sentAt + SPEED_CAP_DURATION - 1000; t += 9000) {
      const a = computeFrame({ now: t, actions: [capped], vehicleIds: ['kao-0002'] }).vehicles[0]!
      const b = computeFrame({ now: t + 200, actions: [capped], vehicleIds: ['kao-0002'] }).vehicles[0]!
      const moved = (((b.mapProgress - a.mapProgress + 1) % 1) * meters) / TIME_SCALE
      const expected = ((a.mapSpeed + b.mapSpeed) / 2 / 3.6) * 0.2
      expect(Math.abs(moved - expected)).toBeLessThanOrEqual(expected * 0.15 + 0.1)
    }
  })

  it('속도 제한 조치가 걸린 90초는 제한 아래로 달리고, 그만큼 뒤처집니다', () => {
    const sentAt = DAY + 4 * 3600_000
    const capped: ActionRecord = { id: 'cap', issueId: 'x', vehicleId: 'kao-0002', action: 'speed-limit', sentAt }
    for (let t = sentAt + 1000; t < sentAt + SPEED_CAP_DURATION; t += 7000) {
      const vehicle = computeFrame({ now: t, actions: [capped], vehicleIds: ['kao-0002'] }).vehicles[0]!
      expect(vehicle.speed).toBeLessThanOrEqual(48 + 0.1)
    }
    const after = sentAt + SPEED_CAP_DURATION + 60_000
    const slow = computeFrame({ now: after, actions: [capped], vehicleIds: ['kao-0002'] }).vehicles[0]!
    const free = computeFrame({ now: after, actions: [], vehicleIds: ['kao-0002'] }).vehicles[0]!
    const behind = (free.lap + free.progress - (slow.lap + slow.progress)) * findRoute('han-river').lengthKm * 1000
    expect(behind).toBeGreaterThan(10)
  })

  it('슈퍼바이크 기울기는 굽은 길과 속도로 정하고(atan(v²κ/g)) 급한 굽이에서도 35°에서 멈춥니다', () => {
    const lean = VEHICLE_SPECS.find((spec) => spec.id === 'kao-0003')!.metrics.find((metric) => metric.key === 'lean')!
    const derive = (speed: number, curvature: number) => lean.derive!({ speed, curvature, progress: 0, elapsed: 0 })
    expect(derive(50, 0)).toBe(0)
    expect(derive(50, 1 / 60)).toBeCloseTo(18.2, 0)
    expect(derive(50, 1 / 5)).toBe(35)
    // 평소에는 경고 기준(42°) 아래이고, 문제가 생겨 치우침이 더해지면 넘습니다.
    expect(35).toBeLessThan(lean.warn!)
    expect(lean.baseline! + Math.abs(lean.fault!.target - lean.nominal)).toBeGreaterThanOrEqual(lean.crit!)
  })
  it('실차 신호인데 기울기·회전수 측정값이 빠지면 실차의 속도와 위치로 채웁니다(서 있으면 기울기 0, 공회전)', () => {
    const now = DAY + 9 * 3600_000 + 777_000
    const readings: LiveReading[] = [{ vehicleId: 'kao-0003', at: now - 1000, speed: 0, metrics: { coolant: 88 } }]
    const ducati = computeFrame({ now, actions: [], readings, vehicleIds: ['kao-0003'] }).vehicles[0]!
    const lean = ducati.metrics.find((metric) => metric.key === 'lean')!.value
    const rpm = ducati.metrics.find((metric) => metric.key === 'rpm')!.value
    expect(lean).toBeLessThanOrEqual(0.6)
    expect(Math.abs(rpm - 1300)).toBeLessThanOrEqual(60)
    // 이력도 그 시각 실차의 속도로 채웁니다.
    const history = computeHistory({ vehicleId: 'kao-0003', metricKey: 'lean', from: now - 20_000, to: now, points: 5, actions: [], readings })!
    expect(history.samples.at(-1)!.value).toBeLessThanOrEqual(0.6)
  })
  it('이력과 관제 프레임은 같은 시각에 같은 실차 위치를 씁니다(가장 새 GPS가 경로 밖이면 둘 다 시뮬레이션 위치)', () => {
    const now = DAY + 9 * 3600_000 + 888_000
    // 오래된 경로 위 위치는 남산 순환에서 가장 급한 굽이로 둡니다(그 위치를 쓰면 기울기가 35° 가까이 나옴).
    const geo = createRouteGeo(findRoute('namsan'))
    let bend = 0
    for (let p = 0; p < 1; p += 0.001) if (Math.abs(turnRateAt(geo, p)) > Math.abs(turnRateAt(geo, bend))) bend = p
    const onRoute = { lat: 37.55, lng: 126.99, progress: bend, odometer: bend }
    const readings: LiveReading[] = [
      { vehicleId: 'kao-0003', at: now - 6000, speed: 45, metrics: { coolant: 88 }, position: onRoute },
      { vehicleId: 'kao-0003', at: now - 2000, speed: 45, metrics: { coolant: 88 }, position: { ...onRoute, progress: null } },
    ]
    const frameLean = computeFrame({ now, actions: [], readings, vehicleIds: ['kao-0003'] }).vehicles[0]!.metrics.find((metric) => metric.key === 'lean')!.value
    const history = computeHistory({ vehicleId: 'kao-0003', metricKey: 'lean', from: now - 20_000, to: now, points: 5, actions: [], readings })!
    expect(history.samples.at(-1)!.value).toBe(frameLean)
    expect(frameLean).toBeLessThan(30)
  })
})
