import { defineEventHandler, setResponseHeader } from 'h3'
import type { SessionResponse } from '../../../src/shared/api/contract'
import { pushPublicKey } from '../../utils/push'
import { readSessionUser } from '../../utils/session'

export default defineEventHandler(async (event): Promise<SessionResponse> => {
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return { user: await readSessionUser(event), pushPublicKey: pushPublicKey() }
})
