import { createError, defineEventHandler, readBody } from 'h3'
import { findIngestVehicle, recordTelemetry, requireIngestToken } from '../../utils/ingest'

interface Body {
  vehicleId?: unknown
  at?: unknown
  speed?: unknown
  metrics?: unknown
  lat?: unknown
  lng?: unknown
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/**
 * 실제 차량(OBD-II 동글, 제조사 커넥티드카 웹훅, 자전거 트래커 등)의 측정값과 GPS를 받습니다.
 * Authorization: Bearer $INGEST_TOKEN. 응답에는 차량이 적용할 원격 조치 명령이 들어 있습니다.
 * 자세한 형식은 docs/integration.md를 참고하세요.
 */
export default defineEventHandler(async (event) => {
  requireIngestToken(event)
  const body = await readBody<Body>(event)
  const vehicle = findIngestVehicle(body?.vehicleId)

  const known = new Set(vehicle.metrics.map((metric) => metric.key))
  const metrics: Record<string, number> = {}
  for (const [key, value] of Object.entries((body?.metrics as Record<string, unknown>) ?? {})) {
    if (!known.has(key) || !isNumber(value)) {
      throw createError({ statusCode: 422, message: `알 수 없는 지표이거나 숫자가 아닙니다: ${key}. 탈것별 지표 key는 docs/integration.md에 있습니다.` })
    }
    metrics[key] = value
  }

  let gps: { lat: number; lng: number } | undefined
  if (body?.lat !== undefined || body?.lng !== undefined) {
    if (!isNumber(body.lat) || !isNumber(body.lng) || Math.abs(body.lat) > 90 || Math.abs(body.lng) > 180) {
      throw createError({ statusCode: 422, message: 'GPS는 lat(-90~90)과 lng(-180~180)를 숫자로 함께 보내 주세요.' })
    }
    gps = { lat: body.lat, lng: body.lng }
  }

  const now = Date.now()
  // 미래 시각은 받지 않습니다(시계 차이 5초까지만 허용). 1분보다 오래된 시각은 지금으로 바꿉니다.
  const at = isNumber(body?.at) && body.at <= now + 5_000 && body.at >= now - 60_000 ? Math.min(body.at, now) : now
  const speed = isNumber(body?.speed) ? body.speed : undefined
  const result = await recordTelemetry(vehicle, { at, speed, metrics, gps }, now)
  return { ok: true, vehicleId: vehicle.id, at, ...result }
})
