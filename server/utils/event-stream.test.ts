// @vitest-environment node
import { createServer, get } from 'node:http'
import type { IncomingMessage, Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createGunzip } from 'node:zlib'
import { createApp, eventHandler, toNodeListener } from 'h3'
import { afterEach, describe, expect, it } from 'vitest'
import { formatEvent, openEventStream } from './event-stream'

let server: Server | null = null
let closedCount = 0

afterEach(() => {
  server?.close()
  server = null
  closedCount = 0
})

/** 이벤트 셋을 80ms 간격으로 보내고 닫는(또는 열어 두는) 시험 서버 */
async function start(options: { keepOpen?: boolean } = {}) {
  const app = createApp()
  app.use(
    '/stream',
    eventHandler((event) => {
      const stream = openEventStream(event)
      stream.onClosed(() => (closedCount += 1))
      let sent = 0
      const timer = setInterval(() => {
        sent += 1
        void stream.push('frame', JSON.stringify({ n: sent, pad: 'x'.repeat(2000) }))
        if (sent === 3 && !options.keepOpen) {
          clearInterval(timer)
          void stream.close()
        }
      }, 80)
      stream.onClosed(() => clearInterval(timer))
      return stream.send()
    }),
  )
  server = createServer(toNodeListener(app))
  await new Promise<void>((resolve) => server!.listen(0, resolve))
  return `http://localhost:${(server!.address() as AddressInfo).port}/stream`
}

const request = (url: string, headers: Record<string, string>) =>
  new Promise<IncomingMessage>((resolve, reject) => get(url, { headers }, resolve).on('error', reject))

describe('openEventStream', () => {
  it('gzip을 받는 브라우저에는 압축해 보내고, 이벤트마다 플러시해 끝나기 전에도 바로 읽힙니다', async () => {
    const response = await request(await start(), { 'accept-encoding': 'gzip, deflate, br' })
    expect(response.headers['content-encoding']).toBe('gzip')
    expect(response.headers['content-type']).toBe('text/event-stream')
    expect(response.headers['cache-control']).toContain('no-transform')
    let raw = 0
    response.on('data', (chunk: Buffer) => (raw += chunk.length))
    const gunzip = response.pipe(createGunzip())
    let text = ''
    // 두 번째 이벤트가 오기 전에(서버는 80ms 간격) 첫 이벤트가 풀려야 플러시가 된 것입니다.
    const firstAt = await new Promise<number>((resolve) => {
      gunzip.on('data', (chunk: Buffer) => {
        text += chunk.toString()
        if (text.includes('"n":1')) resolve(Date.now())
      })
    })
    const secondAt = await new Promise<number>((resolve) => {
      const check = () => (text.includes('"n":2') ? resolve(Date.now()) : setTimeout(check, 5))
      check()
    })
    expect(secondAt - firstAt).toBeGreaterThanOrEqual(40)
    await new Promise((resolve) => gunzip.on('end', resolve))
    expect(text.startsWith('retry: 1000\n\n')).toBe(true)
    expect(text).toContain(formatEvent('frame', JSON.stringify({ n: 3, pad: 'x'.repeat(2000) })))
    // 비슷한 이벤트는 앞 이벤트를 참조해 작게 압축됩니다(풀어 쓴 글자 수보다 훨씬 작음).
    expect(raw).toBeLessThan(text.length / 4)
  })

  it('gzip을 받지 않으면 압축 없이 보냅니다', async () => {
    const response = await request(await start(), {})
    expect(response.headers['content-encoding']).toBeUndefined()
    let text = ''
    response.on('data', (chunk: Buffer) => (text += chunk.toString()))
    await new Promise((resolve) => response.on('end', resolve))
    expect(text).toContain('event: frame\ndata: {"n":3')
  })

  it('클라이언트가 끊으면 닫힘 처리를 한 번만 부릅니다', async () => {
    const response = await request(await start({ keepOpen: true }), { 'accept-encoding': 'gzip' })
    await new Promise((resolve) => response.once('data', resolve))
    response.destroy()
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(closedCount).toBe(1)
  })
})

describe('formatEvent', () => {
  it('이벤트 이름은 한 줄로, 데이터는 줄마다 data:로 씁니다', () => {
    expect(formatEvent('frame', '{"a":1}')).toBe('event: frame\ndata: {"a":1}\n\n')
    expect(formatEvent('a\nb', 'x\ny')).toBe('event: a b\ndata: x\ndata: y\n\n')
  })
})
