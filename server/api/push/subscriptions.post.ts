import { createError, defineEventHandler, readBody } from 'h3'
import { assertSameOrigin, requireUser } from '../../utils/session'
import { useStore } from '../../utils/store'

interface Body {
  endpoint?: unknown
  keys?: { p256dh?: unknown; auth?: unknown }
}

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const user = await requireUser(event)
  const body = await readBody<Body>(event)
  const endpoint = body?.endpoint
  const p256dh = body?.keys?.p256dh
  const auth = body?.keys?.auth
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || typeof p256dh !== 'string' || typeof auth !== 'string') {
    throw createError({ statusCode: 400, message: '알림 구독 정보가 올바르지 않습니다.' })
  }
  await useStore().savePushSubscription({ endpoint, p256dh, auth, userId: user.id })
  return { ok: true }
})
