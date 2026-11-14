import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { invalidateLiveCaches } from '../../../../utils/fleet'
import { authenticateIngest, vehicleIdFor } from '../../../../utils/devices'
import { findIngestVehicle } from '../../../../utils/ingest'
import { useStore } from '../../../../utils/store'

interface Body {
  vehicleId?: unknown
  result?: unknown
  message?: unknown
}

/**
 * 차량이 명령을 적용했는지 알려 줍니다. POST /api/ingest/commands/:id/ack
 * { "vehicleId": "kao-0001", "result": "applied" | "failed", "message": "실패 이유(선택)" }
 */
export default defineEventHandler(async (event) => {
  const principal = await authenticateIngest(event)
  const body = await readBody<Body>(event)
  const vehicle = findIngestVehicle(vehicleIdFor(principal, body?.vehicleId))
  if (body?.result !== 'applied' && body?.result !== 'failed') {
    throw createError({ statusCode: 422, message: 'result는 applied 또는 failed로 보내 주세요.' })
  }
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 200) || null : null
  const now = Date.now()
  const outcome = await useStore().ackCommand({
    id: getRouterParam(event, 'id') ?? '',
    vehicleId: vehicle.id,
    ack: { at: now, result: body.result, message },
    now,
  })
  if (outcome === 'missing') throw createError({ statusCode: 404, message: '이 탈것에 보낸 명령을 찾지 못했습니다. 명령 id를 확인해 주세요.' })
  if (outcome === 'closed') {
    throw createError({ statusCode: 409, message: '이미 응답했거나 응답 시간(2분)이 지난 명령입니다. 관제 센터가 다시 보낸 명령을 확인해 주세요.' })
  }
  invalidateLiveCaches()
  return { ok: true, id: getRouterParam(event, 'id'), result: body.result }
})
