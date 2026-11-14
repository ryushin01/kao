import { createError } from 'h3'
import { findRoute } from '../../src/shared/config/routes'
import { createRouteGeo } from '../../src/shared/lib/route-geo'
import type { RouteGeo } from '../../src/shared/lib/route-geo'
import { VEHICLE_SPECS } from './fleet-specs'
import type { VehicleSpec } from './fleet-specs'
import { invalidateLiveCaches, todaysActions } from './fleet'
import { toCommand } from './command'
import { evaluateLiveIssues, lapOf, nextOdometer } from './sim/live'
import type { LivePosition, LiveReading } from './sim/types'
import { useStore } from './store'

/**
 * 실차 수신 API(/api/ingest/*)가 함께 쓰는 처리. 형식은 docs/integration.md에 있습니다.
 */

export { toCommand } from './command'

/** GPS가 경로에서 이보다 멀면(m) 경로 위 위치로 쓰지 않습니다. */
export const ROUTE_MATCH_LIMIT = 150
/** 측정값 보관 기간(하루). 지표 이력은 최근 60분만 씁니다. */
const READING_RETENTION_MS = 86_400_000
const PRUNE_INTERVAL_MS = 10 * 60_000

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
 * 이미 더 새 측정값이 있는 늦게 도착한 측정값(stale)은 이력에만 저장하고, 문제 판단과 바퀴 수에는 쓰지 않습니다
 * (예: 위험 측정값 뒤에 옛 정상값이 늦게 오면 해결 대기 시간이 옛 시각부터 시작돼 너무 일찍 해결됨).
 */
export async function recordTelemetry(vehicle: VehicleSpec, input: TelemetryInput, now: number) {
  const store = useStore()
  const [latestAt, previous] = await Promise.all([
    store.latestReadingAt(vehicle.id),
    input.gps ? store.lastPositionedReading(vehicle.id, Math.floor(input.at / 3600_000) * 3600_000) : null,
  ])
  const stale = latestAt !== null && input.at < latestAt
  let position: LivePosition | undefined
  if (input.gps) {
    const progress = locateOnRoute(vehicle, input.gps.lat, input.gps.lng)
    const before = previous?.position ? { at: previous.at, position: previous.position } : null
    // 바퀴 수는 GPS 측정값끼리만 이어 붙입니다. 측정값으로는 늦었어도 가장 최근 GPS보다 새 위치면 그대로 이어 갑니다.
    // 가장 최근 GPS보다 오래된 위치는 다음 기준점이 될 일이 없어(시각 순으로 고름) 거리를 그대로 둡니다.
    const odometer = before && input.at < before.at ? before.position.odometer : nextOdometer(before, progress, input.at)
    position = { lat: input.gps.lat, lng: input.gps.lng, progress, odometer }
  }
  const reading: LiveReading = { vehicleId: vehicle.id, at: input.at, speed: input.speed, metrics: input.metrics, position }
  await store.insertReading(reading)

  if (!stale) {
    const actions = await todaysActions(now, true)
    // 같은 탈것의 요청이 겹쳐 그사이 문제가 바뀌었으면(저장 실패) 다시 읽어 판단합니다. 이미 반영한 측정값은 건너뛰므로 다시 해도 안전합니다.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [open, checkedAt] = await Promise.all([store.listOpenLiveIssues(vehicle.id), store.liveIssueWatermarks(vehicle.id)])
      let conflicted = false
      for (const change of evaluateLiveIssues({ vehicle, reading, open, checkedAt, actions, now })) {
        const saved = change.previous
          ? await store.updateLiveIssue(change.record, change.previous.checkedAt)
          : await store.insertLiveIssue(change.record)
        if (!saved) conflicted = true
      }
      if (!conflicted) break
    }
  }
  const commands = await store.takeCommands(vehicle.id, now)
  invalidateLiveCaches()

  if (now - lastPrune > PRUNE_INTERVAL_MS) {
    lastPrune = now
    await store.deleteReadingsBefore(now - READING_RETENTION_MS)
  }

  return {
    /** true면 더 새 측정값이 이미 있어 이력에만 저장했습니다. */
    stale,
    position: position ? { onRoute: position.progress !== null, progress: position.progress, lap: lapOf(position) } : null,
    commands: commands.map((command) => toCommand(vehicle, command)),
  }
}
