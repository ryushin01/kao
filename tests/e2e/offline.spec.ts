import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { loginAs, waitForHydration } from './fixtures'

/**
 * 오프라인 저장(public/sw.js): 한 번 연 화면을 연결이 끊겨도 보여 주는지 실제 브라우저로 확인합니다.
 * 다른 검사는 서비스 워커를 막으므로(playwright.config.ts) 여기서만 켭니다. 오프라인 안내 화면은 Nuxt 화면이 아니라
 * fixtures.ts의 goto(하이드레이션을 기다림) 대신 Playwright 기본 test를 씁니다.
 */
test.use({ serviceWorkers: 'allow', reducedMotion: 'reduce' })

const PAGE_CACHE = 'kao-pages-v1'
const STATIC_CACHE = 'kao-static-v1'
const ASSET_CACHE = 'kao-assets-v1'
const PRIVATE_CACHE = 'kao-private-v1'
const VEHICLE_PAGES = Array.from({ length: 7 }, (_, index) => `/fleet/kao-000${index + 1}`)

function savedPaths(page: Page, cacheName: string) {
  return page.evaluate(async (name) => {
    if (!(await caches.has(name))) return []
    return (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname)
  }, cacheName)
}

/** 화면이 받은 빌드 조각 가운데 아직 이 기기에 저장하지 않은 것 */
function unsavedChunks(page: Page) {
  return page.evaluate(async (name) => {
    const loaded = performance
      .getEntriesByType('resource')
      .map((entry) => new URL(entry.name))
      .filter((url) => url.origin === location.origin && !url.search && /^\/_nuxt\/[\w.-]+\.(?:js|css)$/.test(url.pathname))
      .map((url) => url.pathname)
    const saved = new Set((await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname))
    return [...new Set(loaded)].filter((path) => !saved.has(path))
  }, ASSET_CACHE)
}

/** 이 기기에 저장한 로그인한 사람의 것(user: 누가 로그인했는지, frameAt: 마지막 실시간 상태의 시각) */
function privateState(page: Page) {
  return page.evaluate(async (name) => {
    if (!(await caches.has(name))) return { user: null, frameAt: null }
    const cache = await caches.open(name)
    const user = await (await cache.match('/__kao/user'))?.json()
    const stored = await (await cache.match('/__kao/last-frame'))?.json()
    return { user: (user?.startPage as string | undefined) ?? null, frameAt: (stored?.frame?.at as number | undefined) ?? null }
  }, PRIVATE_CACHE)
}

/** 관제 센터의 "마지막 수신" 시각(ms) */
async function lastReceivedAt(page: Page) {
  const value = await page.locator('xpath=//dt[normalize-space()="마지막 수신"]/following-sibling::dd[1]//time').getAttribute('datetime')
  return Date.parse(value ?? '')
}

/** 관제 센터를 열고 서비스 워커가 화면을 저장할 때까지 기다립니다. */
async function openFleet(page: Page) {
  await loginAs(page, 'operator')
  await page.goto('/fleet')
  await waitForHydration(page)
  await expect.poll(() => savedPaths(page, PAGE_CACHE), { timeout: 30_000 }).toContain('/fleet')
}

test('한 번 연 관제 센터·서울 지도·탈것 화면을 오프라인에서도 마지막 상태로 보여 주고, 저장하지 않은 화면은 안내한다', async ({ page, context }) => {
  // GPU 없는 CI는 지도와 3D 모델을 CPU로 그려, 관제 센터를 두 번 여는 이 검사는 오래 걸립니다.
  test.setTimeout(180_000)
  await openFleet(page)
  // 서울 지도, 화면이 받은 빌드 조각(3D 지도의 three.js 조각 포함), 관제 센터가 잇는 탈것 화면 7개까지 저장한 뒤 연결을 끊습니다.
  await expect.poll(() => savedPaths(page, STATIC_CACHE), { timeout: 30_000 }).toContain('/maps/seoul.json')
  // 관제 센터가 미리 받는 탈것 화면 조각(Nuxt가 [id] 화면 조각에 붙이는 이름 _id_)까지 받은 뒤 저장됐는지 봅니다.
  await expect
    .poll(() => page.evaluate(() => performance.getEntriesByType('resource').some((entry) => /\/_nuxt\/_id_\.[\w-]+\.css$/.test(entry.name))), { timeout: 30_000 })
    .toBe(true)
  await expect.poll(() => unsavedChunks(page), { timeout: 30_000 }).toEqual([])
  await expect.poll(() => savedPaths(page, PAGE_CACHE), { timeout: 60_000 }).toEqual(expect.arrayContaining(VEHICLE_PAGES))
  // 화면을 저장한 뒤에도 실시간 상태를 받다가 끊기면, 끊기는 순간의 상태를 이 기기에 저장합니다.
  await expect(page.getByText('실시간 수신 중')).toBeVisible({ timeout: 30_000 })
  const beforeOffline = await lastReceivedAt(page)

  await context.setOffline(true)
  await expect.poll(async () => (await privateState(page)).frameAt ?? 0, { timeout: 15_000 }).toBeGreaterThanOrEqual(beforeOffline)
  await page.reload()
  await waitForHydration(page)
  await expect(page.getByRole('heading', { level: 1, name: '관제 센터' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '오프라인입니다' })).toBeVisible()
  // 저장해 둔 화면(처음 열 때의 상태)이 아니라 끊기기 직전에 받은 상태를 보여 줍니다.
  await expect.poll(() => lastReceivedAt(page)).toBeGreaterThanOrEqual(beforeOffline)
  // 지도 데이터는 네트워크 없이 이 기기의 저장본에서 받습니다.
  expect(await page.evaluate(async () => (await fetch('/maps/seoul.json')).ok)).toBe(true)
  const notice = await new AxeBuilder({ page }).include('.offline-notice').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(notice.violations).toEqual([])

  // 연 적 없는 탈것 화면도 관제 센터를 저장할 때 미리 저장해 두어 열립니다.
  await page.goto('/fleet/kao-0003')
  await expect(page).toHaveTitle(/KAO 관제$/)
  await waitForHydration(page)

  // 저장하지 않은 화면은 오프라인 안내와 이 기기에 저장된 화면 목록을 보여 줍니다.
  await page.goto('/login')
  await expect(page).toHaveTitle('오프라인 — KAO')
  await expect(page.getByRole('heading', { level: 1, name: '인터넷에 연결되어 있지 않습니다' })).toBeVisible()
  await expect(page.getByRole('link', { name: '관제 센터 — KAO' })).toHaveAttribute('href', '/fleet')
  await expect(page.getByRole('link', { name: /KAO 관제$/ })).toHaveCount(VEHICLE_PAGES.length)
  const fallback = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(fallback.violations).toEqual([])

  // 다시 연결되면 그 화면을 다시 엽니다(로그인한 채라 로그인 화면은 관제 센터로 옮김).
  await context.setOffline(false)
  await expect(page).toHaveTitle('관제 센터 — KAO', { timeout: 30_000 })
})

test('회원은 오프라인에서 홈 화면 앱의 시작 주소(/fleet)를 열어도 자기 탈것 화면이 열린다', async ({ page, context }) => {
  test.slow()
  await loginAs(page, 'member01')
  // 회원이 /fleet을 열면 서버가 자기 탈것 화면으로 보냅니다.
  await page.goto('/fleet')
  await expect(page).toHaveURL(/\/fleet\/kao-0001$/)
  await waitForHydration(page)
  await expect.poll(() => savedPaths(page, PAGE_CACHE), { timeout: 30_000 }).toContain('/fleet/kao-0001')
  await expect.poll(async () => (await privateState(page)).user, { timeout: 30_000 }).toBe('/fleet/kao-0001')

  await context.setOffline(true)
  await page.goto('/fleet')
  await expect(page).toHaveURL(/\/fleet\/kao-0001$/)
  await expect(page).toHaveTitle(/KAO 관제$/)
})

test('로그아웃하면 이 기기에 저장한 관제 화면을 지운다', async ({ page }) => {
  test.slow()
  await openFleet(page)

  await page.getByRole('button', { name: '로그아웃' }).click()
  // 서비스 워커가 맡은 화면에서는 toHaveURL이 앱 안 이동 뒤의 주소를 늦게 읽는 때가 있어, 화면 안의 주소와 소개 화면 제목으로 봅니다.
  await expect.poll(() => page.evaluate(() => location.pathname), { timeout: 30_000 }).toBe('/')
  await expect(page.getByRole('heading', { level: 1, name: /돌이킬 수 없는 지점에/ })).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => savedPaths(page, PAGE_CACHE), { timeout: 30_000 }).not.toContain('/fleet')
  expect(await page.evaluate((name) => caches.has(name), PRIVATE_CACHE)).toBe(false)
})
