import { defineEventHandler, setResponseHeader } from 'h3'
import { frameFor } from '../../utils/fleet'
import { requireUser } from '../../utils/session'

/** 로그인한 사람이 볼 수 있는 탈것의 현재 프레임 */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return frameFor(user)
})
