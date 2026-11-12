import { createEventStream, defineEventHandler } from 'h3'
import { useFleetEngine } from '../../utils/fleet'

const FRAME_INTERVAL = 500

/** 관제 프레임을 0.5초마다 Server-Sent Events로 보냅니다. */
export default defineEventHandler(async (event) => {
  const stream = createEventStream(event)
  const push = () => {
    const frame = useFleetEngine().frame()
    void stream.push({ event: 'frame', data: JSON.stringify(frame) })
  }

  push()
  const timer = setInterval(push, FRAME_INTERVAL)
  stream.onClosed(async () => {
    clearInterval(timer)
    await stream.close()
  })

  return stream.send()
})
