import { createError, defineEventHandler, readBody } from 'h3'
import { assertSameOrigin, requireUser } from '../../utils/session'
import { useStore } from '../../utils/store'

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const user = await requireUser(event)
  const body = await readBody<{ endpoint?: unknown }>(event)
  if (typeof body?.endpoint !== 'string') throw createError({ statusCode: 400, message: 'endpoint가 필요합니다.' })
  await useStore().deletePushSubscription(body.endpoint, user.id)
  return { ok: true }
})
