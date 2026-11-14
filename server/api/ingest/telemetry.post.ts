import { createError, defineEventHandler, getRequestHeader, readBody } from 'h3'
import { VEHICLE_SPECS } from '../../utils/fleet-specs'
import { useStore } from '../../utils/store'

interface Body {
  vehicleId?: unknown
  at?: unknown
  speed?: unknown
  metrics?: unknown
}

/**
 * 실제 차량(OBD-II 동글, 제조사 커넥티드카 웹훅 등)의 측정값을 받습니다.
 * Authorization: Bearer $INGEST_TOKEN. 30초 안에 측정값이 들어온 탈것은 시뮬레이션 대신 이 값을 씁니다.
 * 자세한 형식은 docs/integration.md를 참고하세요.
 */
export default defineEventHandler(async (event) => {
  const token = process.env.INGEST_TOKEN
  if (!token || getRequestHeader(event, 'authorization') !== `Bearer ${token}`) {
    throw createError({ statusCode: 401, message: '인증되지 않은 요청입니다.' })
  }
  const body = await readBody<Body>(event)
  const vehicle = VEHICLE_SPECS.find((item) => item.id === body?.vehicleId)
  if (!vehicle) throw createError({ statusCode: 404, message: '등록되지 않은 탈것입니다.' })

  const known = new Set(vehicle.metrics.map((metric) => metric.key))
  const metrics: Record<string, number> = {}
  for (const [key, value] of Object.entries((body?.metrics as Record<string, unknown>) ?? {})) {
    if (!known.has(key) || typeof value !== 'number' || !Number.isFinite(value)) {
      throw createError({ statusCode: 422, message: `알 수 없는 지표이거나 숫자가 아닙니다: ${key}` })
    }
    metrics[key] = value
  }
  const now = Date.now()
  // 미래 시각은 받지 않습니다(시계 차이 5초까지만 허용). 1분보다 오래된 시각은 지금으로 바꿉니다.
  const at = typeof body?.at === 'number' && body.at <= now + 5_000 && body.at >= now - 60_000 ? Math.min(body.at, now) : now
  const speed = typeof body?.speed === 'number' && Number.isFinite(body.speed) ? body.speed : undefined
  await useStore().insertReading({ vehicleId: vehicle.id, at, speed, metrics })
  return { ok: true, vehicleId: vehicle.id, at }
})
