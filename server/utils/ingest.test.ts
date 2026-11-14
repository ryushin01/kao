// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_ACCOUNTS } from '../../src/shared/api/contract'
import type { SessionUser } from '../../src/shared/api/contract'
import { findRoute } from '../../src/shared/config/routes'
import { createRouteGeo } from '../../src/shared/lib/route-geo'
import { VEHICLE_SPECS } from './fleet-specs'
import { frameFor, sendRemoteAction, todaysActions } from './fleet'
import { locateOnRoute, recordTelemetry } from './ingest'
import { dayStartOf } from './sim/engine'
import { CLEAR_HOLD } from './sim/live'
import { useStore } from './store'

const G80 = VEHICLE_SPECS.find((vehicle) => vehicle.id === 'kao-0001')!
const operatorAccount = DEMO_ACCOUNTS.find((account) => account.role === 'operator')!
const operator: SessionUser = {
  id: `user-${operatorAccount.login}`,
  login: operatorAccount.login,
  name: operatorAccount.name,
  role: 'operator',
  vehicleIds: VEHICLE_SPECS.map((vehicle) => vehicle.id),
}

describe('실차 수신(메모리 저장소)', () => {
  let now = Date.UTC(2026, 10, 14, 4, 0, 5)
  const tick = (ms: number) => {
    now += ms
    vi.setSystemTime(now)
    return now
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
  })
  afterEach(() => vi.useRealTimers())

  it('기준을 넘으면 문제를 열고, 명령을 차량에 전달해 적용 응답을 받은 뒤 지표가 돌아오면 해결합니다', async () => {
    const store = useStore()
    expect(store.kind).toBe('memory')

    const first = await recordTelemetry(G80, { at: now, metrics: { coolant: 109.5 } }, now)
    expect(first.commands).toEqual([])
    const [issue] = await store.listOpenLiveIssues(G80.id)
    expect(issue).toMatchObject({ metricKey: 'coolant', severity: 'warning' })
    const frame = await frameFor(operator, tick(1000))
    expect(frame.vehicles.find((vehicle) => vehicle.id === G80.id)!.issues).toEqual([
      expect.objectContaining({ id: issue!.id, status: 'open', source: 'live' }),
    ])

    const response = await sendRemoteAction(operator, G80.id, issue!.id, 'cooling-mode')
    expect(response.vehicle.issues[0]).toMatchObject({ status: 'resolving', stage: 'awaiting' })
    await expect(sendRemoteAction(operator, G80.id, issue!.id, 'power-limit')).rejects.toMatchObject({ statusCode: 409 })

    const second = await recordTelemetry(G80, { at: tick(1000), metrics: { coolant: 108 } }, now)
    expect(second.commands).toEqual([
      expect.objectContaining({ issueId: issue!.id, action: 'cooling-mode', label: '냉각 모드', expiresAt: response.entry.at + 120_000 }),
    ])
    const commandId = second.commands[0]!.id
    expect(await store.ackCommand({ id: commandId, vehicleId: G80.id, ack: { at: tick(500), result: 'applied', message: null }, now })).toBe('ok')
    expect(await store.ackCommand({ id: commandId, vehicleId: G80.id, ack: { at: now, result: 'failed', message: null }, now })).toBe('closed')
    expect(await store.ackCommand({ id: commandId, vehicleId: 'kao-0002', ack: { at: now, result: 'failed', message: null }, now })).toBe('missing')

    const recovering = await frameFor(operator, tick(500))
    expect(recovering.vehicles.find((vehicle) => vehicle.id === G80.id)!.issues[0]).toMatchObject({ status: 'resolving', stage: 'recovering' })
    expect(recovering.log.map((entry) => entry.phase)).toEqual(['completed', 'sent'])

    await recordTelemetry(G80, { at: tick(1000), metrics: { coolant: 96 } }, now)
    await recordTelemetry(G80, { at: tick(CLEAR_HOLD), metrics: { coolant: 94 } }, now)
    expect(await store.listOpenLiveIssues(G80.id)).toEqual([])
    const resolved = await frameFor(operator, tick(500))
    expect(resolved.vehicles.find((vehicle) => vehicle.id === G80.id)!.issues[0]).toMatchObject({ status: 'resolved', resolvedBy: 'cooling-mode' })
  })

  it('늦게 도착한 옛 측정값은 이력에만 저장하고 문제 판단에 쓰지 않습니다', async () => {
    const store = useStore()
    const critical = tick(1000)
    await recordTelemetry(G80, { at: critical, metrics: { coolant: 118 } }, now)
    const [issue] = await store.listOpenLiveIssues(G80.id)
    expect(issue).toMatchObject({ severity: 'critical', clearedAt: null })
    // 위험 측정값보다 9초 앞선 정상값이 늦게 도착합니다.
    const stale = await recordTelemetry(G80, { at: critical - 9_000, metrics: { coolant: 92 } }, tick(500))
    expect(stale.stale).toBe(true)
    expect((await store.listOpenLiveIssues(G80.id))[0]).toMatchObject({ clearedAt: null })
    expect((await store.listVehicleReadings(G80.id, critical - 9_000, critical - 9_000)).length).toBe(1)
    // 그 뒤 정상값은 받은 시각부터 해결 대기를 시작하므로 1초 만에 해결되지 않습니다.
    const fresh = await recordTelemetry(G80, { at: tick(500), metrics: { coolant: 92 } }, now)
    expect(fresh.stale).toBe(false)
    expect((await store.listOpenLiveIssues(G80.id))[0]).toMatchObject({ clearedAt: now, resolvedAt: null })
    await recordTelemetry(G80, { at: tick(CLEAR_HOLD), metrics: { coolant: 92 } }, now)
    expect(await store.listOpenLiveIssues(G80.id)).toEqual([])
  })

  it('겹친 요청이 먼저 문제를 바꿨으면(checkedAt이 다르면) 덮어쓰지 않습니다', async () => {
    const store = useStore()
    await recordTelemetry(G80, { at: tick(1000), metrics: { battery: 12.2 } }, now)
    const [issue] = (await store.listOpenLiveIssues(G80.id)).filter((item) => item.metricKey === 'battery')
    expect(await store.updateLiveIssue({ ...issue!, severity: 'critical', checkedAt: now + 1 }, issue!.checkedAt - 1)).toBe(false)
    expect(await store.updateLiveIssue({ ...issue!, severity: 'critical', checkedAt: now + 1 }, issue!.checkedAt)).toBe(true)
    // 같은 지표에 해결되지 않은 문제가 있으면 새로 넣지 않습니다(다른 요청이 먼저 연 경우).
    expect(await store.insertLiveIssue({ ...issue!, id: 'live-kao-0001-battery-1' })).toBe(false)
  })

  it('GPS를 경로 위 위치로 바꾸고, 출발선을 지나면 바퀴를 셉니다', async () => {
    const geo = createRouteGeo(findRoute(G80.routeId))
    const at = (progress: number) => geo.toLatLng(progress)
    const before = await recordTelemetry(G80, { at: tick(1000), metrics: {}, gps: at(0.97) }, now)
    expect(before.position).toMatchObject({ onRoute: true, lap: 1 })
    expect(before.position!.progress).toBeCloseTo(0.97, 2)
    const after = await recordTelemetry(G80, { at: tick(1000), metrics: {}, gps: at(0.02) }, now)
    expect(after.position).toMatchObject({ onRoute: true, lap: 2 })
    const vehicle = (await frameFor(operator, tick(100))).vehicles.find((item) => item.id === G80.id)!
    expect(vehicle).toMatchObject({ positionSource: 'gps', lap: 2 })
    // 경로에서 1km쯤 떨어진 곳은 경로 위 위치로 쓰지 않습니다.
    expect(locateOnRoute(G80, at(0.5).lat + 0.01, at(0.5).lng)).toBeNull()
  })
  it('측정값으로는 늦었어도 가장 최근 GPS보다 새 위치면 바퀴 수를 이어 갑니다(출발선을 늦은 측정값에서 지남)', async () => {
    const ducati = VEHICLE_SPECS.find((vehicle) => vehicle.id === 'kao-0003')!
    const geo = createRouteGeo(findRoute(ducati.routeId))
    const t1 = tick(60_000)
    await recordTelemetry(ducati, { at: t1, metrics: {}, gps: geo.toLatLng(0.97) }, now)
    // 지표만 담은 더 새 측정값(t1+2초)이 먼저 오고, 출발선을 지난 GPS(t1+1초)가 늦게 옵니다.
    await recordTelemetry(ducati, { at: t1 + 2000, metrics: { coolant: 90 } }, tick(2000))
    const late = await recordTelemetry(ducati, { at: t1 + 1000, metrics: {}, gps: geo.toLatLng(0.02) }, tick(100))
    expect(late).toMatchObject({ stale: true, position: { onRoute: true, lap: 2 } })
    const next = await recordTelemetry(ducati, { at: t1 + 3000, metrics: {}, gps: geo.toLatLng(0.04) }, tick(900))
    expect(next.position).toMatchObject({ onRoute: true, lap: 2 })
  })

  it('0시 직전에 보낸 명령도 그 명령으로 해결한 문제가 보이는 동안(0시 32분 전부터) 함께 읽습니다', async () => {
    const midnight = dayStartOf(now) + 86_400_000
    await useStore().insertAction({
      id: 'before-midnight', issueId: 'live-kao-0002-oil-1', vehicleId: 'kao-0002', action: 'cooling-mode', sentAt: midnight - 26 * 60_000, userId: operator.id,
    })
    const actions = await todaysActions(midnight + 5 * 60_000, true)
    expect(actions.map((action) => action.id)).toContain('before-midnight')
  })
})
