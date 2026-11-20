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

/** 관제 센터를 열고 서비스 워커가 화면을 저장할 때까지 기다립니다. */
async function openFleet(page: Page) {
  await loginAs(page, 'operator')
  await page.goto('/fleet')
  await waitForHydration(page)
  await expect.poll(() => savedPaths(page, PAGE_CACHE), { timeout: 30_000 }).toContain('/fleet')
}

test('한 번 연 관제 센터와 서울 지도를 오프라인에서도 보여 주고, 저장하지 않은 화면은 안내한다', async ({ page, context }) => {
  // GPU 없는 CI는 지도와 3D 모델을 CPU로 그려, 관제 센터를 두 번 여는 이 검사는 오래 걸립니다.
  test.setTimeout(180_000)
  await openFleet(page)
  // 서울 지도와 화면이 받은 빌드 조각(3D 지도의 three.js 조각 포함)까지 저장한 뒤 연결을 끊습니다.
  await expect.poll(() => savedPaths(page, STATIC_CACHE), { timeout: 30_000 }).toContain('/maps/seoul.json')
  await expect.poll(() => unsavedChunks(page), { timeout: 30_000 }).toEqual([])

  await context.setOffline(true)
  await page.reload()
  await waitForHydration(page)
  await expect(page.getByRole('heading', { level: 1, name: '관제 센터' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: '오프라인입니다' })).toBeVisible()
  // 지도 데이터는 네트워크 없이 이 기기의 저장본에서 받습니다.
  expect(await page.evaluate(async () => (await fetch('/maps/seoul.json')).ok)).toBe(true)
  const notice = await new AxeBuilder({ page }).include('.offline-notice').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(notice.violations).toEqual([])

  // 저장하지 않은 탈것 화면은 오프라인 안내와 이 기기에 저장된 화면 목록을 보여 줍니다.
  await page.goto('/fleet/kao-0003')
  await expect(page).toHaveTitle('오프라인 — KAO')
  await expect(page.getByRole('heading', { level: 1, name: '인터넷에 연결되어 있지 않습니다' })).toBeVisible()
  await expect(page.getByRole('link', { name: '관제 센터 — KAO' })).toHaveAttribute('href', '/fleet')
  const fallback = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(fallback.violations).toEqual([])

  // 다시 연결되면 그 화면을 다시 엽니다.
  await context.setOffline(false)
  await expect(page).toHaveTitle(/KAO 관제$/, { timeout: 30_000 })
})

test('로그아웃하면 이 기기에 저장한 관제 화면을 지운다', async ({ page }) => {
  test.slow()
  await openFleet(page)

  await page.getByRole('button', { name: '로그아웃' }).click()
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })
  await expect.poll(() => savedPaths(page, PAGE_CACHE), { timeout: 15_000 }).not.toContain('/fleet')
})
