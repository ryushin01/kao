import { createError, defineEventHandler, getRouterParam, readBody } from 'h3'
import { ACTIONS } from '../../../../src/shared/api/contract'
import type { ActionCode, RemoteActionRequest } from '../../../../src/shared/api/contract'
import { RemoteActionError, sendRemoteAction } from '../../../utils/fleet'
import { assertSameOrigin, requireUser } from '../../../utils/session'

function isActionRequest(body: unknown): body is RemoteActionRequest {
  if (typeof body !== 'object' || body === null) return false
  const { issueId, action } = body as Record<string, unknown>
  return typeof issueId === 'string' && typeof action === 'string' && action in ACTIONS
}

/** 원격 조치는 관제 요원만 보낼 수 있습니다. */
export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const user = await requireUser(event, 'operator')
  const vehicleId = getRouterParam(event, 'id') ?? ''
  const body = await readBody<unknown>(event)
  if (!isActionRequest(body)) {
    throw createError({ statusCode: 400, message: '요청 형식이 올바르지 않습니다. issueId와 action을 함께 보내 주세요.' })
  }
  try {
    return await sendRemoteAction(user, vehicleId, body.issueId, body.action as ActionCode)
  } catch (error) {
    if (error instanceof RemoteActionError) throw createError({ statusCode: error.statusCode, message: error.message })
    throw error
  }
})
