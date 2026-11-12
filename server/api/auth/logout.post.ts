import { defineEventHandler } from 'h3'
import { assertSameOrigin, endSession } from '../../utils/session'

export default defineEventHandler((event) => {
  assertSameOrigin(event)
  endSession(event)
  return { ok: true }
})
