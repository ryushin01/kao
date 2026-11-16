import { defineEventHandler } from 'h3'
import { openEventStream } from '../../utils/event-stream'
import { frameFor } from '../../utils/fleet'
import { maybeNotify } from '../../utils/push'
import { requireUser } from '../../utils/session'

const FRAME_INTERVAL = 500
/** 서버리스 함수 최대 실행 시간(60초)보다 먼저 닫습니다. EventSource가 1초 뒤 다시 연결합니다(retry). */
const STREAM_LIFETIME = 50_000

/** 0.5초마다 프레임을 보내는 관제 스트림. 브라우저가 받으면 gzip으로 보냅니다(server/utils/event-stream.ts). */
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const stream = openEventStream(event)
  const openedAt = Date.now()
  let busy = false
  let failures = 0

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
      await stream.push('frame', JSON.stringify(await frameFor(user, now)))
      maybeNotify(now)
    } catch (error) {
      // 한 번 실패해도 다음 주기에 다시 보냅니다. 운영에서 원인을 볼 수 있게 연결마다 처음 한 번만 남깁니다.
      if (failures === 0) console.error('[fleet/stream] 프레임을 보내지 못했습니다:', error)
      failures += 1
    } finally {
      busy = false
    }
  }

  const timer = setInterval(push, FRAME_INTERVAL)
  stream.onClosed(() => clearInterval(timer))
  void push()
  return stream.send()
})
