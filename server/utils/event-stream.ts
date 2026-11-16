import { constants, createGzip } from 'node:zlib'
import type { H3Event } from 'h3'
import { createEventStream, getRequestHeader, sendStream, setResponseHeaders } from 'h3'

/**
 * Server-Sent Events 스트림. 브라우저가 gzip을 받으면 gzip으로 보내고 이벤트마다 동기 플러시(Z_SYNC_FLUSH)해
 * 이벤트가 쌓이지 않고 바로 갑니다. 관제 프레임은 0.5초마다 거의 같은 JSON이라, 앞 프레임을 참조해 압축되어
 * 프레임 하나가 약 10 KB에서 수백 바이트로 줄어듭니다(h3의 스트림은 `no-transform`이라 Vercel도 압축하지 않음).
 * gzip을 받지 않는 클라이언트에는 h3의 스트림을 그대로 씁니다.
 */
export interface ServerEventStream {
  readonly compressed: boolean
  push: (event: string, data: string) => Promise<void>
  /** 클라이언트가 끊거나 close()로 닫으면 한 번 부릅니다. */
  onClosed: (callback: () => void) => void
  close: () => Promise<void>
  send: () => Promise<void>
}

/** 연결이 끊긴 뒤 브라우저가 다시 연결하기까지 기다리는 시간(ms). 서버가 50초마다 닫으므로 짧게 둡니다. */
export const RECONNECT_MS = 1000

/** SSE 이벤트 하나(h3와 같은 형식: 이벤트 이름은 한 줄, 데이터는 줄마다 data:) */
export const formatEvent = (name: string, data: string) =>
  `event: ${name.replace(/[\r\n]/g, ' ')}\n${data
    .split(/\r\n|\r|\n/)
    .map((line) => `data: ${line}\n`)
    .join('')}\n`

export function openEventStream(event: H3Event): ServerEventStream {
  if (!/\bgzip\b/i.test(getRequestHeader(event, 'accept-encoding') ?? '')) {
    const stream = createEventStream(event)
    return {
      compressed: false,
      push: (name, data) => stream.push({ event: name, data }),
      onClosed: (callback) => stream.onClosed(callback),
      close: () => stream.close(),
      send: () => stream.send(),
    }
  }

  setResponseHeaders(event, {
    'content-type': 'text/event-stream',
    'cache-control': 'private, no-cache, no-store, no-transform, must-revalidate, max-age=0',
    'content-encoding': 'gzip',
    vary: 'accept-encoding',
    // nginx 같은 프록시가 모아 두지 않게 합니다.
    'x-accel-buffering': 'no',
    // HTTP/2에서는 Connection 헤더를 쓰지 않습니다(h3와 같게).
    ...(getRequestHeader(event, ':path') === undefined ? { connection: 'keep-alive' } : {}),
  })
  const gzip = createGzip({ flush: constants.Z_SYNC_FLUSH })
  const callbacks: Array<() => void> = []
  let closed = false
  const finish = () => {
    if (closed) return
    closed = true
    for (const callback of callbacks.splice(0)) callback()
    gzip.end()
  }
  event.node.res.once('close', finish)
  gzip.write(`retry: ${RECONNECT_MS}\n\n`)

  return {
    compressed: true,
    push: (name, data) =>
      new Promise<void>((resolve, reject) => {
        if (closed) return resolve()
        gzip.write(formatEvent(name, data), (error) => (error ? reject(error) : resolve()))
      }),
    onClosed: (callback) => {
      if (closed) callback()
      else callbacks.push(callback)
    },
    close: async () => finish(),
    send: () => sendStream(event, gzip),
  }
}
