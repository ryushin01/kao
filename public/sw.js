// KAO 서비스 워커: 웹 푸시와 오프라인 저장을 다룹니다.
//
// 오프라인 저장(연결이 끊겨도 한 번 연 화면과 서울 지도를 보여 줌)
// - 화면(HTML): 네트워크를 먼저 쓰고, 받은 화면을 저장합니다. 연결이 없으면 저장한 화면을, 그것도 없으면 /offline.html을 줍니다.
//   응답이 5초 넘게 없으면(Wi-Fi에는 붙었지만 인터넷이 안 될 때 등) 저장한 화면을 먼저 주고, 늦게 온 응답으로 저장본을 갱신합니다.
//   앱 안에서 옮긴 화면은 앱이 'save-page' 메시지로 알려 주면 따로 받아 저장합니다(같은 화면은 10분에 한 번).
//   화면이 서비스 워커가 맡기 전에 받은 자원은 앱이 'save-page'·'save-resources'로 알려 주면 저장합니다.
// - 로그인해야 보이는 화면(/fleet…)은 세션 유지 기간(7일)이 지나면 쓰지 않고, 로그아웃·세션 만료 때 지웁니다.
//   앱이 로그인한 사람을 알려 주면('set-user') 다른 사람이 로그인했을 때 이전 사람의 저장본을 지우고, 오프라인에서
//   저장본이 없는 /fleet(홈 화면 앱의 시작 주소)을 열면 그 사람의 첫 화면(회원은 자기 탈것)으로 보냅니다.
// - 관제 센터를 저장할 때 그 화면이 잇는 탈것 화면도 미리 저장합니다(같은 화면은 10분에 한 번, 데이터 절약 모드면 건너뜀).
// - 빌드 조각(/_nuxt/의 해시 붙은 파일)은 바뀌지 않으므로 저장한 것을 먼저 씁니다.
// - 지도·3D 모델·글꼴·아이콘은 저장한 것을 바로 쓰고, 뒤에서 새로 받아 둡니다.
// - API·실시간 스트림·다른 사이트 요청은 건드리지 않습니다(늘 네트워크).
// 저장 방식을 바꾸면 CACHE_VERSION을 올립니다(새 서비스 워커가 켜질 때 이전 저장소를 지움).
// offline.html을 바꾸면 OFFLINE_PAGE_REVISION을 올립니다(이 파일이 바뀌어야 새로 설치되며 안내 화면을 다시 받음).

const CACHE_VERSION = 'v1'
const OFFLINE_PAGE_REVISION = 1
const PAGE_CACHE = `kao-pages-${CACHE_VERSION}`
const ASSET_CACHE = `kao-assets-${CACHE_VERSION}`
const STATIC_CACHE = `kao-static-${CACHE_VERSION}`
const SHELL_CACHE = `kao-shell-${CACHE_VERSION}-${OFFLINE_PAGE_REVISION}`
/** 로그인한 사람의 것(누가 로그인했는지, 마지막으로 받은 실시간 상태). 로그아웃·세션 만료 때 통째로 지웁니다. */
const PRIVATE_CACHE = `kao-private-${CACHE_VERSION}`
const CURRENT_CACHES = [PAGE_CACHE, ASSET_CACHE, STATIC_CACHE, SHELL_CACHE, PRIVATE_CACHE]

const OFFLINE_PAGE = '/offline.html'
/** 관제 센터. 홈 화면 앱의 시작 주소이고, 회원이 열면 서버가 자기 탈것 화면으로 보냅니다. */
const FLEET_PAGE = '/fleet'
const USER_KEY = '/__kao/user'
/** 저장한 때(ms). 오프라인 안내 화면도 이 값으로 저장한 때를 보여 줍니다. */
const SAVED_AT_HEADER = 'x-kao-saved-at'
/** 로그인해야 보이는 화면을 오프라인에서 보여 주는 기한. 세션 유지 기간(server/utils/session.ts)과 같습니다. */
const PRIVATE_PAGE_MAX_AGE = 7 * 24 * 60 * 60 * 1000
/** 앱 안에서 옮긴 화면을 다시 받아 저장하는 간격 */
const RESAVE_INTERVAL = 10 * 60 * 1000
/** 화면 응답을 기다리는 시간. 넘으면 저장한 화면이 있을 때 그것을 먼저 줍니다(저장본이 없으면 계속 기다림). */
const NETWORK_TIMEOUT = 5000
const MAX_PAGES = 30
const MAX_ASSETS = 200
const MAX_LINKED_PAGES = 12
/** 화면이 아니라 웹 워커가 받아 화면의 자원 목록에 없는 것. 그 화면을 저장할 때 함께 저장합니다. */
const PAGE_EXTRAS = { '/fleet': ['/maps/seoul.json'] }

const HASHED_ASSET = /^\/_nuxt\/[\w.-]+\.(?:js|mjs|css|woff2?|wasm)$/
const BUILD_META = /^\/_nuxt\/builds\/meta\/[\w-]+\.json$/
const STATIC_DIRS = ['/maps/', '/models/', '/fonts/']
const STATIC_FILES = ['/favicon.svg', '/favicon.ico', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/badge-96.png', '/manifest.webmanifest']

/** 로그아웃하면 늘어, 그 전에 받기 시작한 로그인 화면을 저장하지 않게 합니다. */
let privateGeneration = 0
/** 화면별로 받고 있는 저장 작업(같은 화면을 겹쳐 받지 않게) */
const saving = new Map()

const isPrivatePath = (pathname) => pathname === '/fleet' || pathname.startsWith('/fleet/')
const isHtml = (response) => (response.headers.get('content-type') ?? '').includes('text/html')
const savedAt = (response) => Number(response.headers.get(SAVED_AT_HEADER) ?? 0)
/** 화면은 주소의 경로로만 저장합니다(로그인 화면의 ?redirect= 같은 질의 문자열은 빼고). */
const pageKey = (url) => new URL(url.pathname, self.location.origin).href
/** 로그인해야 보이는 화면을 거절하면 세션이 끝난 것입니다. 돌려보내기(redirect)는 세션이 있어도 생기므로 따로 묻습니다. */
const isRejected = (response) => response.status === 401 || response.status === 403
const jsonResponse = (value) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

/** 'asset': 저장한 것을 먼저, 'static': 저장한 것을 쓰고 뒤에서 새로 받기, null: 건드리지 않음 */
function assetKind(url) {
  if (url.origin !== self.location.origin) return null
  const path = url.pathname
  if (!url.search && (HASHED_ASSET.test(path) || BUILD_META.test(path))) return 'asset'
  if (STATIC_DIRS.some((dir) => path.startsWith(dir)) || STATIC_FILES.includes(path)) return 'static'
  return null
}

async function saveOfflinePage({ force }) {
  const cache = await caches.open(SHELL_CACHE)
  if (!force && (await cache.match(OFFLINE_PAGE))) return
  // 브라우저의 HTTP 캐시를 거치지 않고 새로 받습니다.
  const response = await fetch(new Request(new URL(OFFLINE_PAGE, self.location.origin), { cache: 'reload' }))
  if (!response.ok) throw new Error(`오프라인 안내 화면을 받지 못했습니다(${response.status}).`)
  await cache.put(OFFLINE_PAGE, response)
}

async function trim(cache, max) {
  const requests = await cache.keys()
  const extra = requests.length - max
  if (extra > 0) await Promise.all(requests.slice(0, extra).map((request) => cache.delete(request)))
}

async function savePage(url, response, generation) {
  if ((response.headers.get('cache-control') ?? '').includes('no-store')) return
  const html = await response.text()
  // 화면이 쓰는 빌드 조각을 먼저 모두 저장합니다. 하나라도 받지 못하면 그 화면은 저장하지 않습니다
  // (조각 없이 저장한 화면을 오프라인에서 열면 오류 화면이 되므로, 안내 화면이 낫습니다).
  if (!(await storeLinkedAssets(html))) return
  // 받는 사이에 로그아웃했으면 로그인해야 보이는 화면은 남기지 않습니다.
  if (isPrivatePath(url.pathname) && generation !== privateGeneration) return
  const headers = new Headers(response.headers)
  headers.set(SAVED_AT_HEADER, String(Date.now()))
  const cache = await caches.open(PAGE_CACHE)
  await cache.put(pageKey(url), new Response(html, { status: 200, statusText: response.statusText, headers }))
  // 저장하는 사이에 로그아웃했으면(지우기가 저장보다 먼저 끝났을 수 있음) 방금 저장한 로그인 화면을 지웁니다.
  if (isPrivatePath(url.pathname) && generation !== privateGeneration) {
    await cache.delete(pageKey(url))
    return
  }
  await trim(cache, MAX_PAGES)
  if (url.pathname === FLEET_PAGE) await saveLinkedPages(html)
}

/** 관제 센터가 잇는 탈것 화면(/fleet/:id)도 미리 저장해, 오프라인에서도 열리게 합니다. */
async function saveLinkedPages(html) {
  if (self.navigator?.connection?.saveData) return
  const paths = new Set()
  for (const [, path] of html.matchAll(/href="(\/fleet\/[\w-]+)"/g)) paths.add(path)
  await Promise.allSettled([...paths].slice(0, MAX_LINKED_PAGES).map((path) => refreshPage(new URL(path, self.location.origin))))
}

/**
 * 화면이 쓰는 빌드 조각(stylesheet·modulepreload·script)과 Nuxt 앱 정보(builds/meta, 화면을 열 때 받음)를 저장하고, 모두
 * 저장했으면 true입니다. 처음 방문한 화면이나 미리 저장하는 화면은 이것들이 아직 저장되지 않았을 수 있습니다.
 */
async function storeLinkedAssets(html) {
  const paths = new Set()
  for (const [, path] of html.matchAll(/(?:href|src)="(\/_nuxt\/[^"?#]+)"/g)) paths.add(path)
  const buildId = html.match(/buildId:"([\w-]+)"/)?.[1]
  if (buildId) paths.add(`/_nuxt/builds/meta/${buildId}.json`)
  const results = await Promise.allSettled([...paths].map((path) => storeResource(new URL(path, self.location.origin))))
  return results.every((result) => result.status === 'fulfilled' && result.value)
}

async function savedPage(url) {
  const cache = await caches.open(PAGE_CACHE)
  const key = pageKey(url)
  const response = await cache.match(key, { ignoreVary: true })
  if (!response) return null
  if (isPrivatePath(url.pathname) && Date.now() - savedAt(response) > PRIVATE_PAGE_MAX_AGE) {
    await cache.delete(key)
    return null
  }
  return response
}

async function forgetPrivatePages() {
  privateGeneration += 1
  const cache = await caches.open(PAGE_CACHE)
  const requests = await cache.keys()
  await Promise.all(requests.filter((request) => isPrivatePath(new URL(request.url).pathname)).map((request) => cache.delete(request)))
  await caches.delete(PRIVATE_CACHE)
}

/**
 * 로그인해야 보이는 화면이 다른 화면으로 돌려보내면 세션이 끝났는지 서버에 묻고, 끝났으면 저장본을 지웁니다.
 * 회원이 /fleet을 열면 세션이 있어도 자기 탈것 화면으로 돌려보내므로, 돌려보내기만으로는 지우지 않습니다. 묻지 못하면 그대로 둡니다.
 */
async function forgetIfSignedOut() {
  let response
  try {
    response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } })
  } catch {
    return
  }
  const body = response.ok ? await response.json().catch(() => null) : null
  if (response.status === 401 || (body && !body.user)) await forgetPrivatePages()
}

async function readUser() {
  const response = await (await caches.open(PRIVATE_CACHE)).match(USER_KEY)
  return response ? response.json().catch(() => null) : null
}

/** 앱이 알려 준 로그인한 사람을 기억합니다. 다른 사람이면 이전 사람의 저장본(화면·실시간 상태)을 먼저 지웁니다. */
async function rememberUser(userId, startPage) {
  const stored = await readUser()
  if (stored?.userId && stored.userId !== userId) await forgetPrivatePages()
  await (await caches.open(PRIVATE_CACHE)).put(USER_KEY, jsonResponse({ userId, startPage }))
}

/** 오프라인에서 저장본이 없는 /fleet을 열면 로그인한 사람의 첫 화면(회원은 자기 탈것)으로 보냅니다. */
async function startPageRedirect(url) {
  if (url.pathname !== FLEET_PAGE) return null
  const startPage = (await readUser().catch(() => null))?.startPage
  if (typeof startPage !== 'string' || startPage === FLEET_PAGE || !isPrivatePath(startPage)) return null
  return Response.redirect(new URL(startPage, self.location.origin).href, 302)
}

const TIMED_OUT = Symbol('timed out')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 받은 화면 응답으로 저장본을 갱신하거나, 로그인 화면이 거절·돌려보내면 저장본을 지웁니다. */
function handlePageResponse(event, url, response, generation) {
  if (isPrivatePath(url.pathname) && isRejected(response)) {
    event.waitUntil(forgetPrivatePages())
  } else if (isPrivatePath(url.pathname) && response.type === 'opaqueredirect') {
    event.waitUntil(forgetIfSignedOut())
  } else if (response.status === 200 && isHtml(response) && url.pathname !== OFFLINE_PAGE) {
    event.waitUntil(savePage(url, response.clone(), generation))
  }
  return response
}

async function respondToPage(event, url) {
  const generation = privateGeneration
  const network = Promise.resolve(event.preloadResponse)
    .then((preloaded) => preloaded ?? fetch(event.request))
    .then((response) => handlePageResponse(event, url, response, generation))
  const first = await Promise.race([network.catch(() => null), delay(NETWORK_TIMEOUT).then(() => TIMED_OUT)])
  if (first && first !== TIMED_OUT) return first
  // 연결이 없거나(오류) 응답이 늦으면 저장한 화면을 줍니다. 늦은 응답은 마저 받아 저장본을 갱신합니다.
  const fallback = (await savedPage(url)) ?? (await startPageRedirect(url))
  if (fallback) {
    if (first === TIMED_OUT) event.waitUntil(network.catch(() => {}))
    return fallback
  }
  if (first === TIMED_OUT) {
    try {
      return await network
    } catch {
      // 끝내 받지 못하면 아래의 오프라인 안내 화면을 줍니다.
    }
  }
  return (await caches.match(OFFLINE_PAGE, { cacheName: SHELL_CACHE })) ?? Response.error()
}

async function cacheFirst(event, request) {
  const cache = await caches.open(ASSET_CACHE)
  const cached = await cache.match(request.url, { ignoreVary: true })
  if (cached) return cached
  const response = await fetch(request)
  if (response.ok) event.waitUntil(cache.put(request.url, response.clone()).then(() => trim(cache, MAX_ASSETS)))
  return response
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request.url, { ignoreVary: true })
  const network = fetch(request).then((response) => {
    if (response.ok) event.waitUntil(cache.put(request.url, response.clone()))
    return response
  })
  if (!cached) return network
  event.waitUntil(network.catch(() => {}))
  return cached
}

/** 앱이 알려 준 화면을 저장합니다. 같은 화면을 10분 안에 저장했으면 다시 받지 않습니다. */
function refreshPage(url) {
  const key = pageKey(url)
  if (url.pathname === OFFLINE_PAGE) return Promise.resolve()
  if (!saving.has(key)) {
    const generation = privateGeneration
    const job = (async () => {
      const saved = await (await caches.open(PAGE_CACHE)).match(key, { ignoreVary: true })
      if (saved && Date.now() - savedAt(saved) < RESAVE_INTERVAL) return
      const response = await fetch(key, { credentials: 'same-origin', redirect: 'manual', headers: { accept: 'text/html' } })
      if (response.status === 200 && isHtml(response)) await savePage(url, response, generation)
      else if (isPrivatePath(url.pathname) && isRejected(response)) await forgetPrivatePages()
      else if (isPrivatePath(url.pathname) && response.type === 'opaqueredirect') await forgetIfSignedOut()
    })().finally(() => saving.delete(key))
    saving.set(key, job)
  }
  return saving.get(key)
}

/** 빌드 조각·글꼴·모델 하나를 저장합니다(이미 저장했으면 건너뜀). 저장소에 있으면 true입니다. */
async function storeResource(url) {
  const kind = assetKind(url)
  if (!kind) return false
  const cache = await caches.open(kind === 'asset' ? ASSET_CACHE : STATIC_CACHE)
  if (await cache.match(url.href, { ignoreVary: true })) return true
  const response = await fetch(url.href)
  if (!response.ok) return false
  await cache.put(url.href, response)
  if (kind === 'asset') await trim(cache, MAX_ASSETS)
  return true
}

/** 앱이 알려 준 자원 가운데 저장할 것(같은 사이트의 빌드 조각·지도·모델·글꼴·아이콘)만 저장합니다. */
function storeResources(items) {
  const targets = new Set()
  for (const item of items) {
    if (typeof item !== 'string') continue
    try {
      const target = new URL(item, self.location.origin)
      if (assetKind(target)) targets.add(target.href)
    } catch {
      // 주소가 아니면 건너뜁니다.
    }
  }
  return Promise.allSettled([...targets].map((href) => storeResource(new URL(href))))
}

async function saveFromClient(href, resources) {
  const url = new URL(href, self.location.origin)
  if (url.origin !== self.location.origin) return
  await Promise.allSettled([refreshPage(url), saveOfflinePage({ force: false }), storeResources([...resources, ...(PAGE_EXTRAS[url.pathname] ?? [])])])
}

// 새 버전(알림 아이콘 등)을 기다리지 않고 바로 씁니다. 오프라인 안내 화면을 받지 못해도 설치는 마칩니다(푸시는 써야 하므로).
self.addEventListener('install', (event) => {
  event.waitUntil(
    saveOfflinePage({ force: true })
      .catch(() => {})
      .then(() => self.skipWaiting()),
  )
})

// 이전 버전의 저장소를 지우고, 열려 있는 KAO 창도 바로 맡습니다(알림을 누르면 그 창을 옮기고, 오프라인 저장을 시작하려고).
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((name) => name.startsWith('kao-') && !CURRENT_CACHES.includes(name)).map((name) => caches.delete(name)))
      // 화면 요청이 서비스 워커가 깨어나기를 기다리지 않게, 깨어나는 동안 브라우저가 화면을 미리 요청합니다.
      await self.registration.navigationPreload?.enable().catch(() => {})
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || request.headers.has('range')) return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    event.respondWith(respondToPage(event, url))
    return
  }
  const kind = assetKind(url)
  if (kind === 'asset') event.respondWith(cacheFirst(event, request))
  else if (kind === 'static') event.respondWith(staleWhileRevalidate(event, request))
})

self.addEventListener('message', (event) => {
  const data = event.data ?? {}
  if (data.type === 'save-page' && typeof data.url === 'string') {
    event.waitUntil(saveFromClient(data.url, Array.isArray(data.resources) ? data.resources : []))
  } else if (data.type === 'save-resources' && Array.isArray(data.resources)) {
    event.waitUntil(storeResources(data.resources))
  } else if (data.type === 'set-user' && typeof data.userId === 'string' && typeof data.startPage === 'string') {
    event.waitUntil(rememberUser(data.userId, data.startPage))
  } else if (data.type === 'forget-private-pages') {
    event.waitUntil(forgetPrivatePages())
  }
})

self.addEventListener('push', (event) => {
  let data = { title: 'KAO', body: '', url: '/', tag: 'kao' }
  try {
    data = { ...data, ...event.data.json() }
  } catch {
    // 형식이 다르면 기본 문구를 씁니다.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      // 안드로이드 크롬은 SVG 아이콘을 쓰지 못합니다. 배지는 알림 표시줄용 흰 단색 PNG입니다.
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      lang: 'ko',
      data: { url: data.url },
    }),
  )
})

// 알림을 누르면 그 화면이 열린 창을, 없으면 열려 있는 KAO 창을 그 화면으로 옮기고, 창이 없으면 새로 엽니다.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url ?? '/', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      const exact = windows.find((client) => client.url === url)
      if (exact) return exact.focus()
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin)
      if (open) {
        try {
          const moved = await open.navigate(url)
          return (moved ?? open).focus()
        } catch {
          // 이 서비스 워커가 맡지 않은 창은 옮길 수 없어 새로 엽니다.
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
