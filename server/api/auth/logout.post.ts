import { defineEventHandler } from 'h3'
import { assertSameOrigin, endSession } from '../../utils/session'

/** 이 세션만 서버에서 지우고 쿠키를 지웁니다. */
export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  await endSession(event)
  return { ok: true }
})
