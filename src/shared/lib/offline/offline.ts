import { readonly, ref } from 'vue'

/**
 * 오프라인 저장(public/sw.js)과 앱을 잇습니다. 서비스 워커는 받은 화면과 빌드 조각·지도·모델·글꼴을 이 기기에 저장해,
 * 연결이 끊겨도 한 번 연 화면을 보여 줍니다.
 */

/** 저장한 화면이 들어 있는 저장소 이름. public/sw.js·public/offline.html과 같아야 합니다(서비스 워커 테스트가 확인). */
export const OFFLINE_PAGE_CACHE = 'kao-pages-v1'
const SERVICE_WORKER_URL = '/sw.js'

/** 로그인해야 보이는 화면(관제 센터·탈것 상세). 로그아웃·세션 만료 때 저장본을 지웁니다. */
export const isPrivatePagePath = (path: string) => path === '/fleet' || path.startsWith('/fleet/')

const online = ref(true)
let watchingOnline = false

/** 브라우저의 연결 상태를 따라갑니다. 서버가 그린 화면과 어긋나지 않게 마운트한 뒤에 부릅니다. */
export function initOnlineStatus() {
  if (watchingOnline || typeof window === 'undefined') return
  watchingOnline = true
  online.value = navigator.onLine
  window.addEventListener('online', () => (online.value = true))
  window.addEventListener('offline', () => (online.value = false))
}

export function useOnline() {
  return readonly(online)
}

const supportsServiceWorker = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator

const sameOriginResources = (entries: PerformanceEntryList) => {
  const prefix = `${window.location.origin}/`
  return entries.map((entry) => entry.name).filter((name) => name.startsWith(prefix))
}

/** 이 화면과, 화면이 이미 받은 같은 사이트 자원(서비스 워커가 맡기 전에 받은 빌드 조각·글꼴·모델)을 저장하게 합니다. */
function postSavePage(worker: ServiceWorker | null | undefined) {
  if (!worker) return
  const resources = sameOriginResources(performance.getEntriesByType('resource'))
  worker.postMessage({ type: 'save-page', url: window.location.pathname, resources })
}

let pendingResources = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | undefined

async function flushResources() {
  const worker = (await navigator.serviceWorker.getRegistration().catch(() => undefined))?.active
  if (!worker || pendingResources.size === 0) return
  worker.postMessage({ type: 'save-resources', resources: [...pendingResources] })
  pendingResources = new Set()
}

/**
 * 화면이 나중에 받는 자원(3D 지도의 three.js 조각, 미리 받는 다음 화면 조각 등)도 모아 2초마다 한꺼번에 알립니다.
 * 서비스 워커가 맡기 직전에 받기 시작한 것도 빠지지 않게 하고, 이미 저장한 것은 서비스 워커가 건너뜁니다.
 */
function watchResources() {
  if (typeof PerformanceObserver === 'undefined') return
  new PerformanceObserver((list) => {
    for (const name of sameOriginResources(list.getEntries())) pendingResources.add(name)
    flushTimer ??= setTimeout(() => {
      flushTimer = undefined
      void flushResources()
    }, 2000)
  }).observe({ type: 'resource' })
}

/**
 * 서비스 워커를 등록하고, 켜지면 지금 화면을 저장하게 합니다. 서비스 워커를 쓸 수 없으면 온라인에서만 씁니다.
 * 웹 푸시도 같은 서비스 워커를 씁니다(같은 주소로 다시 등록해도 하나).
 */
export async function registerOfflineSupport() {
  if (!supportsServiceWorker()) return
  try {
    await navigator.serviceWorker.register(SERVICE_WORKER_URL)
    watchResources()
    postSavePage((await navigator.serviceWorker.ready).active)
  } catch {
    // 등록하지 못하면(사생활 보호 모드 등) 오프라인 저장 없이 씁니다.
  }
}

/** 앱 안에서 화면을 옮긴 뒤 부릅니다. 화면을 옮겨도 HTML 요청이 없으므로 서비스 워커가 따로 받아 저장합니다. */
export async function savePageForOffline() {
  if (!supportsServiceWorker()) return
  const registration = await navigator.serviceWorker.getRegistration().catch(() => undefined)
  postSavePage(registration?.active)
}

/** 이 기기에 저장한 로그인 화면을 지웁니다. 로그아웃·세션 만료 때 다음 사람이 이전 계정의 관제 화면을 보지 않게 합니다. */
export async function forgetPrivatePages() {
  if (typeof window === 'undefined') return
  // 서비스 워커가 받고 있던 로그인 화면도 저장하지 않게 알립니다.
  if (supportsServiceWorker()) navigator.serviceWorker.controller?.postMessage({ type: 'forget-private-pages' })
  if (!('caches' in window) || !(await caches.has(OFFLINE_PAGE_CACHE))) return
  const cache = await caches.open(OFFLINE_PAGE_CACHE)
  const requests = await cache.keys()
  await Promise.all(requests.filter((request) => isPrivatePagePath(new URL(request.url).pathname)).map((request) => cache.delete(request)))
}
