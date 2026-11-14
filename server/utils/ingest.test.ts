// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_ACCOUNTS } from '../../src/shared/api/contract'
import type { SessionUser } from '../../src/shared/api/contract'
import { findRoute } from '../../src/shared/config/routes'
import { createRouteGeo } from '../../src/shared/lib/route-geo'
import { VEHICLE_SPECS } from './fleet-specs'
import { frameFor, sendRemoteAction } from './fleet'
import { locateOnRoute, recordTelemetry } from './ingest'
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
})
