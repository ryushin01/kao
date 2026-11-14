import { timingSafeEqual } from 'node:crypto'
import { createError, getRequestHeader } from 'h3'
import type { H3Event } from 'h3'
import { ACTIONS } from '../../src/shared/api/contract'
import { findRoute } from '../../src/shared/config/routes'
import { createRouteGeo } from '../../src/shared/lib/route-geo'
import type { RouteGeo } from '../../src/shared/lib/route-geo'
import { VEHICLE_SPECS } from './fleet-specs'
import type { VehicleSpec } from './fleet-specs'
import { invalidateLiveCaches, todaysActions } from './fleet'
import { capValue } from './sim/engine'
import { ACK_TIMEOUT, evaluateLiveIssues, lapOf, nextOdometer } from './sim/live'
import type { ActionRecord, LivePosition, LiveReading } from './sim/types'
import { useStore } from './store'

/**
 * 실차 수신 API(/api/ingest/*)가 함께 쓰는 처리. 형식은 docs/integration.md에 있습니다.
 */

/** GPS가 경로에서 이보다 멀면(m) 경로 위 위치로 쓰지 않습니다. */
export const ROUTE_MATCH_LIMIT = 150
/** 측정값 보관 기간(하루). 지표 이력은 최근 60분만 씁니다. */
const READING_RETENTION_MS = 86_400_000
const PRUNE_INTERVAL_MS = 10 * 60_000

/** Authorization: Bearer $INGEST_TOKEN. 길이가 같을 때 시간이 일정한 비교로 확인합니다. */
export function requireIngestToken(event: H3Event) {
  const token = process.env.INGEST_TOKEN
  const expected = Buffer.from(`Bearer ${token ?? ''}`)
  const actual = Buffer.from(getRequestHeader(event, 'authorization') ?? '')
  if (!token || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw createError({ statusCode: 401, message: '인증되지 않은 요청입니다.' })
  }
}

export function findIngestVehicle(vehicleId: unknown): VehicleSpec {
  const vehicle = VEHICLE_SPECS.find((item) => item.id === vehicleId)
  if (!vehicle) throw createError({ statusCode: 404, message: '등록되지 않은 탈것입니다. vehicleId를 확인해 주세요.' })
  return vehicle
}

const geos = new Map<string, RouteGeo>()

/** 경로 위 위치(0 이상 1 미만). 경로에서 ROUTE_MATCH_LIMIT보다 멀면 null */
export function locateOnRoute(vehicle: VehicleSpec, lat: number, lng: number) {
  let geo = geos.get(vehicle.routeId)
  if (!geo) {
    geo = createRouteGeo(findRoute(vehicle.routeId))
    geos.set(vehicle.routeId, geo)
  }
  const match = geo.match(lat, lng)
  return match.distance <= ROUTE_MATCH_LIMIT ? match.progress : null
}

/** 차량에 보내는 명령. 속도·출력 제한은 적용할 값을 함께 보냅니다. */
export function toCommand(vehicle: VehicleSpec, action: ActionRecord) {
  const parameters =
    action.action === 'speed-limit'
      ? { maxSpeedKmh: capValue(vehicle, 'speed-limit') }
      : action.action === 'power-limit'
        ? { powerRatio: 0.6 }
        : undefined
  return {
    id: action.id,
    issueId: action.issueId,
    action: action.action,
    label: ACTIONS[action.action].label,
    description: ACTIONS[action.action].description,
    sentAt: action.sentAt,
    expiresAt: action.sentAt + ACK_TIMEOUT,
    ...(parameters ? { parameters } : {}),
  }
}

export interface TelemetryInput {
  at: number
  speed?: number
  metrics: Record<string, number>
  gps?: { lat: number; lng: number }
}

let lastPrune = 0

/**
 * 측정값을 저장하고, 실측 문제를 열거나 해결하고, 차량이 받아 갈 명령을 돌려줍니다.
 * GPS가 있으면 경로 위 위치와 매시 정각부터 간 거리(바퀴)를 함께 저장합니다.
 */
export async function recordTelemetry(vehicle: VehicleSpec, input: TelemetryInput, now: number) {
  const store = useStore()
  let position: LivePosition | undefined
  if (input.gps) {
    const progress = locateOnRoute(vehicle, input.gps.lat, input.gps.lng)
    const previous = await store.lastPositionedReading(vehicle.id, Math.floor(input.at / 3600_000) * 3600_000)
    const odometer = nextOdometer(previous?.position ? { at: previous.at, position: previous.position } : null, progress, input.at)
    position = { lat: input.gps.lat, lng: input.gps.lng, progress, odometer }
  }
  const reading: LiveReading = { vehicleId: vehicle.id, at: input.at, speed: input.speed, metrics: input.metrics, position }
  await store.insertReading(reading)

  const [actions, open] = await Promise.all([todaysActions(now, true), store.listOpenLiveIssues(vehicle.id)])
  const changes = evaluateLiveIssues({ vehicle, reading, open, actions, now })
  for (const change of changes) {
    if (change.created) await store.insertLiveIssue(change.record)
    else await store.updateLiveIssue(change.record)
  }
  const commands = await store.takeCommands(vehicle.id, now)
  invalidateLiveCaches()

  if (now - lastPrune > PRUNE_INTERVAL_MS) {
    lastPrune = now
    await store.deleteReadingsBefore(now - READING_RETENTION_MS)
  }

  return {
    position: position ? { onRoute: position.progress !== null, progress: position.progress, lap: lapOf(position) } : null,
    commands: commands.map((command) => toCommand(vehicle, command)),
  }
}
