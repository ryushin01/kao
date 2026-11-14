import { defineEventHandler } from 'h3'
import { sendTestPush } from '../../utils/push'
import { assertSameOrigin, requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const user = await requireUser(event)
  return { sent: await sendTestPush(user.id) }
})
