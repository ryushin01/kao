// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from './index.js'

/** 메모리로 흉내 낸 KV */
function fakeKv() {
  const data = new Map<string, string>()
  return {
    data,
    get: vi.fn(async (key: string) => (data.has(key) ? JSON.parse(data.get(key)!) : null)),
    put: vi.fn(async (key: string, value: string) => void data.set(key, value)),
    delete: vi.fn(async (key: string) => void data.delete(key)),
  }
}

/** 크론 한 번 실행(waitUntil로 넘긴 일을 끝까지 기다림) */
async function run(env: object, scheduledTime: number) {
  let task: Promise<unknown> = Promise.resolve()
  await worker.scheduled({ scheduledTime }, env as never, { waitUntil: (promise: Promise<unknown>) => void (task = promise) })
  await task
}

const respond = (body: object, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }))
// 한국 시간 13시(기록 정리 시간이 아님)
const NOON = Date.UTC(2026, 10, 16, 4, 0)

afterEach(() => vi.unstubAllGlobals())

describe('위험 알림 크론 워커', () => {
  it('구독이 없다는 답을 1시간 기억하고, 그동안은 서버를 부르지 않습니다', async () => {
    const kv = fakeKv()
    const fetch = respond({ sent: 0, issues: 0, subscriptions: 0 })
    vi.stubGlobal('fetch', fetch)
    const env = { SITE_URL: 'https://kao.example', CRON_SECRET: 's', GATE: kv }
    await run(env, NOON)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(kv.data.get('no-subscribers')!)).toEqual({ until: NOON + 3600_000 })
    await run(env, NOON + 5 * 60_000)
    await run(env, NOON + 55 * 60_000)
    expect(fetch).toHaveBeenCalledTimes(1)
    await run(env, NOON + 60 * 60_000)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('기록을 지우는 한국 시간 4시대에는 기억과 상관없이 부릅니다', async () => {
    const kv = fakeKv()
    const fourAm = Date.UTC(2026, 10, 15, 19, 0)
    kv.data.set('no-subscribers', JSON.stringify({ until: fourAm + 3600_000 }))
    const fetch = respond({ sent: 0, issues: 0, subscriptions: 0, pruned: true })
    vi.stubGlobal('fetch', fetch)
    await run({ SITE_URL: 'https://kao.example', CRON_SECRET: 's', GATE: kv }, fourAm + 5 * 60_000)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('구독이 생기면 기억을 지우고, 구독 수를 모르는 답(이전 서버)이나 실패한 답에는 기억을 바꾸지 않습니다', async () => {
    const kv = fakeKv()
    kv.data.set('no-subscribers', JSON.stringify({ until: NOON - 1 }))
    vi.stubGlobal('fetch', respond({ sent: 1, issues: 1, subscriptions: 2 }))
    await run({ SITE_URL: 'https://kao.example', CRON_SECRET: 's', GATE: kv }, NOON)
    expect(kv.data.has('no-subscribers')).toBe(false)

    vi.stubGlobal('fetch', respond({ sent: 0, issues: 2 }))
    await run({ SITE_URL: 'https://kao.example', CRON_SECRET: 's', GATE: kv }, NOON + 5 * 60_000)
    expect(kv.put).not.toHaveBeenCalled()

    vi.stubGlobal('fetch', respond({ statusCode: 500 }, 500))
    await expect(run({ SITE_URL: 'https://kao.example', CRON_SECRET: 's', GATE: kv }, NOON + 10 * 60_000)).rejects.toThrow('500')
    expect(kv.put).not.toHaveBeenCalled()
  })

  it('인증 헤더를 붙여 /api/cron/notify를 부릅니다(KV가 없어도 동작)', async () => {
    const fetch = respond({ sent: 0, issues: 0, subscriptions: 0 })
    vi.stubGlobal('fetch', fetch)
    await run({ SITE_URL: 'https://kao.example', CRON_SECRET: 'secret' }, NOON)
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe('https://kao.example/api/cron/notify')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret')
  })
})
