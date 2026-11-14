import { describe, expect, it } from 'vitest'
import { VEHICLE_SPECS } from '../fleet-specs'
import {
  ACK_TIMEOUT,
  CLEAR_HOLD,
  commandStage,
  evaluateLiveIssues,
  lapOf,
  liveActionLog,
  liveIssueId,
  liveIssueMetric,
  liveIssueView,
  liveStateOf,
  nextOdometer,
  RECOVERY_TIMEOUT,
} from './live'
import type { ActionRecord, LiveIssueRecord, LiveReading } from './types'

const G80 = VEHICLE_SPECS.find((vehicle) => vehicle.id === 'kao-0001')!
const COOLANT = G80.metrics.find((metric) => metric.key === 'coolant')!
const T = Date.UTC(2026, 10, 14, 3, 10)

const reading = (at: number, metrics: Record<string, number>, extra: Partial<LiveReading> = {}): LiveReading => ({
  vehicleId: G80.id,
  at,
  metrics,
  ...extra,
})

const openIssue = (patch: Partial<LiveIssueRecord> = {}): LiveIssueRecord => ({
  id: liveIssueId(G80.id, 'coolant', T),
  vehicleId: G80.id,
  metricKey: 'coolant',
  severity: 'warning',
  detectedAt: T,
  clearedAt: null,
  resolvedAt: null,
  ...patch,
})

const command = (patch: Partial<ActionRecord> = {}): ActionRecord => ({
  id: 'c1',
  issueId: liveIssueId(G80.id, 'coolant', T),
  vehicleId: G80.id,
  action: 'cooling-mode',
  sentAt: T + 5_000,
  ...patch,
})

describe('liveStateOf', () => {
  it('30초 안의 측정값을 지표마다 가장 새 값으로 합칩니다', () => {
    const readings = [
      reading(T - 40_000, { battery: 11.9 }),
      reading(T - 20_000, { coolant: 99, battery: 13.8 }, { speed: 50 }),
      reading(T - 1_000, { coolant: 101 }),
    ]
    expect(liveStateOf(readings, G80.id, T)).toEqual({ at: T - 1_000, speed: 50, metrics: { coolant: 101, battery: 13.8 } })
    expect(liveStateOf(readings, G80.id, T + 30_000)).toBeNull()
    expect(liveStateOf(readings, 'kao-0002', T)).toBeNull()
  })
})

describe('nextOdometer', () => {
  const at = (progress: number | null, odometer: number, time = T) => ({ at: time, position: { lat: 0, lng: 0, progress, odometer } })

  it('출발선을 앞으로 지나면 한 바퀴가 늘고, 출발선 근처에서 GPS가 흔들려도 바퀴가 쌓이지 않습니다', () => {
    const crossed = nextOdometer(at(0.98, 0.98), 0.02, T + 1000)
    expect(crossed).toBeCloseTo(1.02)
    expect(lapOf({ odometer: crossed })).toBe(2)
    // 0.99 → 0.01 → 0.99 → 0.01로 흔들리면 늘었다 줄었다 할 뿐입니다.
    let odometer = 0.99
    let progress = 0.99
    for (const next of [0.01, 0.99, 0.01, 0.99]) {
      odometer = nextOdometer(at(progress, odometer), next, T + 1000)
      progress = next
    }
    expect(lapOf({ odometer })).toBe(1)
  })

  it('정각이 지나면 1바퀴째부터, 경로에서 벗어나 있으면 거리를 그대로 둡니다', () => {
    const nextHour = Math.ceil(T / 3600_000) * 3600_000
    expect(nextOdometer(at(0.5, 3.5), 0.6, nextHour + 1000)).toBeCloseTo(0.6)
    expect(nextOdometer(null, 0.3, T)).toBeCloseTo(0.3)
    expect(nextOdometer(at(0.5, 2.5), null, T + 1000)).toBe(2.5)
    expect(nextOdometer(at(null, 2.5), 0.7, T + 1000)).toBe(2.5)
  })
})

describe('evaluateLiveIssues', () => {
  const evaluate = (value: number, at: number, open: LiveIssueRecord[] = [], actions: ActionRecord[] = []) =>
    evaluateLiveIssues({ vehicle: G80, reading: reading(at, { coolant: value }), open, actions, now: at })

  it('경고 기준을 넘으면 문제를 열고, 위험 기준을 넘으면 등급을 올리며 내리지는 않습니다', () => {
    expect(evaluate(95, T)).toEqual([])
    const [opened] = evaluate(COOLANT.warn! + 1, T)
    expect(opened).toEqual({ created: true, record: openIssue() })
    const [escalated] = evaluate(COOLANT.crit! + 1, T + 1000, [opened!.record])
    expect(escalated).toEqual({ created: false, record: openIssue({ severity: 'critical' }) })
    expect(evaluate(COOLANT.warn! + 1, T + 2000, [escalated!.record])).toEqual([])
  })

  it('기준 안으로 돌아온 뒤 CLEAR_HOLD 동안 유지되면 해결하고, 그 사이 다시 넘으면 처음부터 기다립니다', () => {
    const [cleared] = evaluate(95, T + 1000, [openIssue()])
    expect(cleared!.record).toMatchObject({ clearedAt: T + 1000, resolvedAt: null })
    expect(evaluate(108, T + 2000, [cleared!.record])[0]!.record.clearedAt).toBeNull()
    const [resolved] = evaluate(95, T + 1000 + CLEAR_HOLD, [cleared!.record])
    expect(resolved!.record).toMatchObject({ clearedAt: T + 1000, resolvedAt: T + 1000 + CLEAR_HOLD })
  })

  it('차량 응답을 기다리는 명령이 있으면 응답이 올 때까지 해결하지 않습니다', () => {
    const issue = openIssue({ clearedAt: T + 6_000 })
    const at = T + 6_000 + CLEAR_HOLD
    expect(evaluate(95, at, [issue], [command()])).toEqual([])
    const applied = command({ ack: { at: at - 500, result: 'applied', message: null } })
    expect(evaluate(95, at, [issue], [applied])[0]!.record.resolvedAt).toBe(at)
  })

  it('기준이 없거나 문제 설명이 없는 지표(속도, 회전수)는 문제로 열지 않습니다', () => {
    expect(evaluateLiveIssues({ vehicle: G80, reading: reading(T, { rpm: 6900, speed: 239 }), open: [], actions: [], now: T })).toEqual([])
  })
})

describe('liveIssueView', () => {
  const view = (now: number, actions: ActionRecord[] = [], record = openIssue()) => liveIssueView(record, COOLANT, actions, now)

  it('명령을 보내면 차량 응답을 기다리고, 응답이 없거나 실패하면 다시 조치할 수 있게 엽니다', () => {
    expect(view(T + 1000)).toMatchObject({ status: 'open', source: 'live', title: COOLANT.fault!.title })
    expect(view(T + 6_000, [command()])).toMatchObject({ status: 'resolving', stage: 'awaiting' })
    expect(view(T + 5_000 + ACK_TIMEOUT, [command()])).toMatchObject({ status: 'open' })
    const failed = command({ ack: { at: T + 8_000, result: 'failed', message: '팬 모터 응답 없음' } })
    expect(view(T + 9_000, [failed]).status).toBe('open')
  })

  it('차량이 적용하면 지표가 돌아오기를 기다리고, RECOVERY_TIMEOUT이 지나도 해결되지 않으면 다시 엽니다', () => {
    const applied = command({ ack: { at: T + 8_000, result: 'applied', message: null } })
    expect(view(T + 9_000, [applied])).toMatchObject({ status: 'resolving', stage: 'recovering' })
    expect(view(T + 8_000 + RECOVERY_TIMEOUT, [applied]).status).toBe('open')
    const resolved = view(T + 30_000, [applied], openIssue({ clearedAt: T + 12_000, resolvedAt: T + 22_000 }))
    expect(resolved).toMatchObject({ status: 'resolved', resolvedBy: 'cooling-mode', resolvedAt: T + 22_000 })
    expect(view(T + 30_000, [], openIssue({ resolvedAt: T + 22_000 })).resolvedBy).toBeUndefined()
  })

  it('마지막 명령만 상태를 정합니다', () => {
    const old = command({ id: 'c0', sentAt: T + 1000, ack: { at: T + 1000 + ACK_TIMEOUT, result: 'timeout', message: null } })
    const next = command({ id: 'c2', sentAt: T + 2000 + ACK_TIMEOUT })
    expect(commandStage(next, T + 3000 + ACK_TIMEOUT)).toBe('awaiting')
    expect(view(T + 3000 + ACK_TIMEOUT, [next, old])).toMatchObject({ status: 'resolving', stage: 'awaiting' })
  })
})

describe('liveActionLog', () => {
  const label = 'G80 · 냉각수 과열: 냉각 모드'

  it('전송 뒤 적용 완료, 실패, 응답 없음, 적용 뒤 회복 안 됨을 기록합니다', () => {
    const phases = (action: ActionRecord, now: number, issue = openIssue()) => liveActionLog(action, label, now, issue).map((entry) => [entry.phase, entry.message])
    expect(phases(command(), T + 6_000)).toEqual([['sent', `${label} 명령 전송`]])
    expect(phases(command(), T + 5_000 + ACK_TIMEOUT)[1]).toEqual(['failed', `${label} 명령에 2분 동안 차량 응답 없음`])
    expect(phases(command({ ack: { at: T + 7_000, result: 'failed', message: '팬 모터 응답 없음' } }), T + 8_000)[1]).toEqual([
      'failed',
      `${label} 차량 적용 실패 — 팬 모터 응답 없음`,
    ])
    const applied = command({ ack: { at: T + 7_000, result: 'applied', message: null } })
    expect(phases(applied, T + 8_000)[1]).toEqual(['completed', `${label} 차량 적용 완료`])
    expect(phases(applied, T + 7_000 + RECOVERY_TIMEOUT)[2]![0]).toBe('failed')
    // 그 전에 해결했으면 회복 안 됨 기록은 없습니다.
    expect(phases(applied, T + 7_000 + RECOVERY_TIMEOUT, openIssue({ resolvedAt: T + 60_000 }))).toHaveLength(2)
  })
})

describe('liveIssueMetric', () => {
  it('하이픈이 든 탈것 id와 지표 key에서도 지표를 꺼냅니다', () => {
    expect(liveIssueMetric(liveIssueId('kao-0001', 'tire-fl', T), 'kao-0001')).toBe('tire-fl')
    expect(liveIssueMetric('kao-0001-coolant-1-2', 'kao-0001')).toBeNull()
  })
})
