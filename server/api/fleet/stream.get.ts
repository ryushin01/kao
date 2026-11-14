import { createEventStream, defineEventHandler } from 'h3'
import { frameFor } from '../../utils/fleet'
import { maybeNotify } from '../../utils/push'
import { requireUser } from '../../utils/session'

const FRAME_INTERVAL = 500
/** 서버리스 함수 최대 실행 시간(60초)보다 먼저 닫습니다. EventSource가 알아서 다시 연결합니다. */
const STREAM_LIFETIME = 50_000

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const stream = createEventStream(event)
  const openedAt = Date.now()
  let busy = false

  const push = async () => {
    if (busy) return
    busy = true
    try {
      const now = Date.now()
      if (now - openedAt > STREAM_LIFETIME) {
        clearInterval(timer)
        await stream.close()
        return
      }
      await stream.push({ event: 'frame', data: JSON.stringify(await frameFor(user, now)) })
      maybeNotify(now)
    } catch {
      // 한 번 실패해도 다음 주기에 다시 보냅니다.
    } finally {
      busy = false
    }
  }

  const timer = setInterval(push, FRAME_INTERVAL)
  stream.onClosed(async () => {
    clearInterval(timer)
    await stream.close()
  })
  void push()
  return stream.send()
})
