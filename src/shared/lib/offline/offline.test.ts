// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetPrivatePages, initOnlineStatus, isPrivatePagePath, OFFLINE_PAGE_CACHE, useOnline } from './offline'

/**
 * 오프라인 저장: 앱 쪽 함수와 서비스 워커(public/sw.js)의 저장 규칙을 확인합니다. 서비스 워커는 가짜 환경(저장소·네트워크)에서
 * 돌립니다. 실제 브라우저에서 오프라인으로 여는 흐름은 tests/e2e/offline.spec.ts가 확인합니다.
 */

const ORIGIN = 'https://kao.test'
const read = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8')
const SW_SOURCE = read('public/sw.js')
const OFFLINE_HTML = read('public/offline.html')

type RequestLike = string | URL | { url: string }
const toUrl = (input: RequestLike) => (typeof input === 'string' ? new URL(input, ORIGIN).href : input instanceof URL ? input.href : input.url)

interface Stored {
  body: ArrayBuffer
  status: number
  statusText: string
  headers: [string, string][]
}

/** 주소로만 찾는 Cache API 흉내(서비스 워커가 쓰는 만큼만) */
class FakeCache {
  readonly entries = new Map<string, Stored>()

  async match(input: RequestLike) {
    const stored = this.entries.get(toUrl(input))
    return stored && new Response(stored.body.slice(0), { status: stored.status, statusText: stored.statusText, headers: stored.headers })
  }

  async put(input: RequestLike, response: Response) {
    const key = toUrl(input)
    const stored = { body: await response.arrayBuffer(), status: response.status, statusText: response.statusText, headers: [...response.headers] }
    this.entries.delete(key)
    this.entries.set(key, stored)
  }

  async delete(input: RequestLike) {
    return this.entries.delete(toUrl(input))
  }

  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url))
  }

  paths() {
    return [...this.entries.keys()].map((url) => new URL(url).pathname)
  }
}

class FakeCacheStorage {
  readonly stores = new Map<string, FakeCache>()

  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new FakeCache())
    return this.stores.get(name)!
  }

  async has(name: string) {
    return this.stores.has(name)
  }

  async delete(name: string) {
    return this.stores.delete(name)
  }

  async keys() {
    return [...this.stores.keys()]
  }

  async match(input: RequestLike, options?: { cacheName?: string }) {
    for (const name of options?.cacheName ? [options.cacheName] : this.stores.keys()) {
      const found = await this.stores.get(name)?.match(input)
      if (found) return found
    }
    return undefined
  }
}

describe('오프라인 저장(앱)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('로그인해야 보이는 화면은 관제 센터와 탈것 상세다', () => {
    expect(['/fleet', '/fleet/kao-0001'].every(isPrivatePagePath)).toBe(true)
    expect(['/', '/login', '/fleetx', '/offline.html'].some(isPrivatePagePath)).toBe(false)
  })

  it('로그아웃하면 저장한 로그인 화면만 지우고, 받고 있던 것도 저장하지 않게 서비스 워커에 알린다', async () => {
    const storage = new FakeCacheStorage()
    const pages = await storage.open(OFFLINE_PAGE_CACHE)
    for (const path of ['/', '/login', '/fleet', '/fleet/kao-0001']) await pages.put(path, new Response(path))
    const postMessage = vi.fn()
    vi.stubGlobal('window', { caches: storage })
    vi.stubGlobal('caches', storage)
    vi.stubGlobal('navigator', { serviceWorker: { controller: { postMessage } } })

    await forgetPrivatePages()

    expect(pages.paths()).toEqual(['/', '/login'])
    expect(postMessage).toHaveBeenCalledWith({ type: 'forget-private-pages' })
  })

  it('브라우저의 연결 상태를 따라간다', () => {
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    vi.stubGlobal('navigator', { onLine: false })
    initOnlineStatus()
    const online = useOnline()

    expect(online.value).toBe(false)
    target.dispatchEvent(new Event('online'))
    expect(online.value).toBe(true)
    target.dispatchEvent(new Event('offline'))
    expect(online.value).toBe(false)
  })
})

class FakeExtendableEvent {
  readonly pending: Promise<unknown>[] = []

  waitUntil(promise: Promise<unknown>) {
    this.pending.push(promise)
  }

  /** waitUntil은 앞선 작업 안에서 다시 불릴 수 있어, 더 늘지 않을 때까지 기다립니다. */
  async settled() {
    let count = -1
    while (count !== this.pending.length) {
      count = this.pending.length
      await Promise.allSettled(this.pending)
    }
  }
}

class FakeFetchEvent extends FakeExtendableEvent {
  response: Promise<Response> | undefined
  readonly preloadResponse = Promise.resolve(undefined)

  constructor(readonly request: object) {
    super()
  }

  respondWith(response: Promise<Response>) {
    this.response = response
    this.waitUntil(response)
  }
}

class FakeMessageEvent extends FakeExtendableEvent {
  constructor(readonly data: unknown) {
    super()
  }
}

/** 브라우저만 만들 수 있는 응답: 화면 요청이 로그인으로 돌려보냄(redirect: 'manual') */
const opaqueRedirect = () => ({ type: 'opaqueredirect', status: 0, ok: false, headers: new Headers() }) as unknown as Response

const BUILD_ID = 'build-1'
const page = (title: string) =>
  new Response(
    `<!doctype html><html><head><title>${title}</title><link rel="stylesheet" href="/_nuxt/entry.Ab12.css">` +
      '<link rel="modulepreload" as="script" crossorigin href="/_nuxt/Cd34.js"></head><body>' +
      `<script>window.__NUXT__={};window.__NUXT__.config={app:{baseURL:"/",buildId:"${BUILD_ID}",buildAssetsDir:"/_nuxt/"}}</script></body></html>`,
    { headers: { 'content-type': 'text/html;charset=utf-8' } },
  )

const navigation = (path: string, method = 'GET') => ({ url: `${ORIGIN}${path}`, method, mode: 'navigate', headers: new Headers() })
const subresource = (url: string, headers?: HeadersInit) => ({ url: new URL(url, ORIGIN).href, method: 'GET', mode: 'cors', headers: new Headers(headers) })

type Listener = (event: FakeExtendableEvent) => void

function startServiceWorker() {
  const listeners = new Map<string, Listener>()
  const network = new Map<string, () => Response | Promise<Response>>()
  const state = { offline: false }
  const fetch = vi.fn(async (input: RequestLike) => {
    if (state.offline) throw new TypeError('Failed to fetch')
    const respond = network.get(new URL(toUrl(input)).pathname)
    return respond ? respond() : new Response('없음', { status: 404 })
  })
  const caches = new FakeCacheStorage()
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(async () => {}),
    registration: { navigationPreload: { enable: vi.fn(async () => {}) } },
    clients: { claim: vi.fn(async () => {}) },
  }
  // 서비스 워커 파일은 앱 번들이 아니라 그대로 내보내는 정적 파일이라, 원문을 가짜 전역으로 감싸 실행합니다.
  new Function('self', 'caches', 'fetch', SW_SOURCE)(self, caches, fetch)
  network.set('/offline.html', () => new Response(OFFLINE_HTML, { headers: { 'content-type': 'text/html' } }))

  async function dispatch<T extends FakeExtendableEvent>(type: string, event: T) {
    listeners.get(type)!(event)
    await event.settled()
    return event
  }

  return {
    self,
    caches,
    fetch,
    network,
    state,
    install: () => dispatch('install', new FakeExtendableEvent()),
    activate: () => dispatch('activate', new FakeExtendableEvent()),
    message: (data: unknown) => dispatch('message', new FakeMessageEvent(data)),
    /** 서비스 워커가 맡지 않으면 undefined */
    request: async (request: object) => (await dispatch('fetch', new FakeFetchEvent(request))).response,
    paths: async (name: string) => (await caches.open(name)).paths(),
  }
}

const text = async (response: Promise<Response | undefined>) => (await response)!.text()

describe('오프라인 저장(서비스 워커)', () => {
  let sw: ReturnType<typeof startServiceWorker>

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-20T09:00:00+09:00'))
    sw = startServiceWorker()
    await sw.install()
    await sw.activate()
  })

  afterEach(() => vi.useRealTimers())

  it('앱·오프라인 안내 화면과 같은 저장소 이름·헤더·기한을 쓴다', async () => {
    sw.network.set('/', () => page('소개'))
    await sw.request(navigation('/'))

    expect(await sw.paths(OFFLINE_PAGE_CACHE)).toEqual(['/'])
    expect(OFFLINE_HTML).toContain(`const PAGE_CACHE = '${OFFLINE_PAGE_CACHE}'`)
    const saved = await (await sw.caches.open(OFFLINE_PAGE_CACHE)).match('/')
    expect(Number(saved!.headers.get('x-kao-saved-at'))).toBe(Date.now())
    expect(OFFLINE_HTML).toContain("const SAVED_AT_HEADER = 'x-kao-saved-at'")
    const maxAge = (source: string) => source.match(/const PRIVATE_PAGE_MAX_AGE = ([^\n]+)/)?.[1]
    expect(maxAge(OFFLINE_HTML)).toBe(maxAge(SW_SOURCE))
  })

  it('설치할 때 오프라인 안내 화면을 HTTP 캐시를 거치지 않고 받고, 켜질 때 이전 버전 저장소를 지운다', async () => {
    const installFetch = sw.fetch.mock.calls.map(([input]) => input).find((input) => input instanceof Request)
    expect(installFetch).toMatchObject({ url: `${ORIGIN}/offline.html`, cache: 'reload' })
    expect(await sw.caches.match('/offline.html')).toBeDefined()
    expect(sw.self.skipWaiting).toHaveBeenCalled()

    await sw.caches.open('kao-pages-v0')
    await sw.caches.open('other-app')
    await sw.activate()
    expect(await sw.caches.has('kao-pages-v0')).toBe(false)
    expect(await sw.caches.has('other-app')).toBe(true)
    expect(sw.self.registration.navigationPreload.enable).toHaveBeenCalled()
    expect(sw.self.clients.claim).toHaveBeenCalled()
  })

  it('받은 화면을 저장하고, 연결이 없으면 저장한 화면을, 저장하지 않은 화면은 오프라인 안내를 준다', async () => {
    sw.network.set('/fleet', () => page('관제 센터 — KAO'))
    expect(await text(sw.request(navigation('/fleet')))).toContain('관제 센터 — KAO')

    sw.state.offline = true
    expect(await text(sw.request(navigation('/fleet')))).toContain('관제 센터 — KAO')
    expect(await text(sw.request(navigation('/fleet/kao-0003')))).toContain('인터넷에 연결되어 있지 않습니다')
  })

  it('저장한 화면이 쓰는 빌드 조각과 Nuxt 앱 정보 파일도 함께 저장한다', async () => {
    sw.network.set('/fleet', () => page('관제 센터 — KAO'))
    for (const path of ['/_nuxt/entry.Ab12.css', '/_nuxt/Cd34.js', `/_nuxt/builds/meta/${BUILD_ID}.json`]) sw.network.set(path, () => new Response(path))
    await sw.request(navigation('/fleet'))

    expect(await sw.paths('kao-assets-v1')).toEqual(['/_nuxt/entry.Ab12.css', '/_nuxt/Cd34.js', `/_nuxt/builds/meta/${BUILD_ID}.json`])
  })

  it('세션 유지 기간(7일)이 지난 로그인 화면은 보여 주지 않고 지운다. 공개 화면은 기한이 없다', async () => {
    sw.network.set('/', () => page('소개'))
    sw.network.set('/fleet', () => page('관제 센터 — KAO'))
    await sw.request(navigation('/'))
    await sw.request(navigation('/fleet'))

    vi.setSystemTime(Date.now() + 7 * 24 * 60 * 60 * 1000 + 1)
    sw.state.offline = true
    expect(await text(sw.request(navigation('/fleet')))).toContain('인터넷에 연결되어 있지 않습니다')
    expect(await text(sw.request(navigation('/')))).toContain('소개')
    expect(await sw.paths(OFFLINE_PAGE_CACHE)).toEqual(['/'])
  })

  it('로그인 화면이 로그인으로 돌려보내면(세션이 끝남) 저장한 로그인 화면을 모두 지운다', async () => {
    sw.network.set('/', () => page('소개'))
    sw.network.set('/fleet', () => page('관제 센터 — KAO'))
    sw.network.set('/fleet/kao-0001', () => page('Genesis G80 — KAO 관제'))
    for (const path of ['/', '/fleet', '/fleet/kao-0001']) await sw.request(navigation(path))

    sw.network.set('/fleet', opaqueRedirect)
    const response = await sw.request(navigation('/fleet'))

    expect((await response!).type).toBe('opaqueredirect')
    expect(await sw.paths(OFFLINE_PAGE_CACHE)).toEqual(['/'])
  })

  it('API·실시간 스트림·다른 사이트·POST·구간 요청·질의 문자열이 붙은 조각은 맡지 않는다', async () => {
    const untouched = [
      subresource('/api/fleet'),
      subresource('/api/fleet/stream'),
      subresource('https://tile.example.com/1/2/3.png'),
      subresource('/_nuxt/builds/latest.json?1732000000'),
      subresource('/_nuxt/src/app/entrypoint/AppRoot.vue?t=1'),
      subresource('/models/genesis-g80.glb', { range: 'bytes=0-99' }),
      navigation('/api/auth/logout', 'POST'),
    ]
    for (const request of untouched) expect(await sw.request(request)).toBeUndefined()
  })

  it('빌드 조각은 저장한 것을 먼저 쓰고, 지도·모델·글꼴은 저장한 것을 바로 쓰며 뒤에서 새로 받는다', async () => {
    sw.network.set('/_nuxt/Cd34.js', () => new Response('조각'))
    await sw.request(subresource('/_nuxt/Cd34.js'))
    sw.state.offline = true
    expect(await text(sw.request(subresource('/_nuxt/Cd34.js')))).toBe('조각')
    sw.state.offline = false

    let version = 1
    sw.network.set('/maps/seoul.json', () => new Response(`지도 ${version}`))
    expect(await text(sw.request(subresource('/maps/seoul.json')))).toBe('지도 1')
    version = 2
    expect(await text(sw.request(subresource('/maps/seoul.json')))).toBe('지도 1')
    expect(await text(sw.request(subresource('/maps/seoul.json')))).toBe('지도 2')
  })

  it('앱이 알린 관제 화면을 지도·받아 둔 자원과 함께 저장하고, 10분 안에는 다시 받지 않는다', async () => {
    sw.network.set('/fleet', () => page('관제 센터 — KAO'))
    sw.network.set('/maps/seoul.json', () => new Response('지도'))
    sw.network.set('/fonts/kao-sans-rest.css', () => new Response('글꼴'))
    sw.network.set('/_nuxt/Ef56.js', () => new Response('조각'))
    const resources = [`${ORIGIN}/_nuxt/Ef56.js`, `${ORIGIN}/fonts/kao-sans-rest.css`, `${ORIGIN}/api/fleet`, 'https://other.example/x.js']
    const pageFetches = () => sw.fetch.mock.calls.filter(([input]) => toUrl(input) === `${ORIGIN}/fleet`).length

    await sw.message({ type: 'save-page', url: '/fleet', resources })
    expect(await sw.paths(OFFLINE_PAGE_CACHE)).toEqual(['/fleet'])
    expect(await sw.paths('kao-static-v1')).toEqual(expect.arrayContaining(['/maps/seoul.json', '/fonts/kao-sans-rest.css']))
    expect(await sw.paths('kao-assets-v1')).toContain('/_nuxt/Ef56.js')
    expect(sw.fetch.mock.calls.some(([input]) => toUrl(input).includes('/api/') || toUrl(input).startsWith('https://other.example'))).toBe(false)

    await sw.message({ type: 'save-page', url: '/fleet', resources: [] })
    expect(pageFetches()).toBe(1)
    vi.setSystemTime(Date.now() + 10 * 60 * 1000 + 1)
    await sw.message({ type: 'save-page', url: '/fleet', resources: [] })
    expect(pageFetches()).toBe(2)
  })

  it('앱이 나중에 알린 자원 가운데 같은 사이트의 조각·지도·모델만 저장한다', async () => {
    sw.network.set('/_nuxt/three.Gh78.js', () => new Response('three'))
    sw.network.set('/models/genesis-g80.lite.glb', () => new Response('모델'))
    await sw.message({ type: 'save-resources', resources: [`${ORIGIN}/_nuxt/three.Gh78.js`, `${ORIGIN}/models/genesis-g80.lite.glb`, `${ORIGIN}/api/fleet`, 42] })

    expect(await sw.paths('kao-assets-v1')).toEqual(['/_nuxt/three.Gh78.js'])
    expect(await sw.paths('kao-static-v1')).toEqual(['/models/genesis-g80.lite.glb'])
    expect(sw.fetch.mock.calls.some(([input]) => toUrl(input).includes('/api/'))).toBe(false)
  })

  it('로그아웃하면 그 전에 받기 시작한 로그인 화면도 저장하지 않는다', async () => {
    let release!: () => void
    sw.network.set('/fleet', () => new Promise<Response>((resolve) => (release = () => resolve(page('관제 센터 — KAO')))))

    const saving = sw.message({ type: 'save-page', url: '/fleet', resources: [] })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await sw.message({ type: 'forget-private-pages' })
    release()
    await saving

    expect(await sw.paths(OFFLINE_PAGE_CACHE)).toEqual([])
  })
})
