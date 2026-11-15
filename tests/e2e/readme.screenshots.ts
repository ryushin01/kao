import { spawn } from 'node:child_process'
import { devices, expect, test, type Locator, type Page } from '@playwright/test'
import { loginAs, waitForHydration } from './fixtures'

/**
 * README 화면 촬영 (pnpm screenshots, 먼저 pnpm build). 결과: docs/images/*.jpg
 * 화면의 탈것·회원·주행 기록은 모두 시뮬레이션과 데모 계정입니다. SCREENSHOTS=1일 때만 프로젝트가 생깁니다.
 * 실제 3D 모델을 그리므로 모델 요청을 막지 않습니다.
 */
const OUT = 'docs/images'

test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

async function settle(page: Page, wait = 2500) {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(wait)
}

const shoot = (target: Page | Locator, name: string) =>
  target.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 82 })

test.describe('데스크톱', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('소개와 로그인', async ({ page }) => {
    await page.goto('/')
    await waitForHydration(page)
    await settle(page, 4000)
    await shoot(page, 'home')

    const miniature = page.locator('section[aria-labelledby="miniature-title"]')
    await miniature.scrollIntoViewIfNeeded()
    // MPV(토요타 알파드)를 골라 그 모델이 표시된 뒤 찍습니다.
    await miniature.getByRole('radio', { name: /^MPV/ }).check()
    await expect(miniature.locator('.spec')).toContainText('MPV')
    await settle(page, 4000)
    await shoot(miniature, 'miniature')

    await page.goto('/login')
    await waitForHydration(page)
    await settle(page, 1000)
    await shoot(page.locator('main .hud-panel').first(), 'login')
  })

  test('관제 지도와 지표 이력', async ({ page }) => {
    await loginAs(page, 'operator')
    await page.goto('/fleet')
    await waitForHydration(page)
    await settle(page, 6000)
    await shoot(page.locator('section.tracker').first(), 'fleet')

    await page.goto('/fleet/kao-0001')
    await waitForHydration(page)
    const history = page.locator('section.history')
    await expect(history.getByRole('group', { name: /이력 그래프/ })).toBeVisible({ timeout: 15_000 })
    await history.scrollIntoViewIfNeeded()
    // 기본 10분 대신 최근 60분을 보여 줍니다.
    await history.getByRole('radio', { name: '최근 60분' }).check()
    await expect(history.getByRole('radio', { name: '최근 60분' })).toBeChecked()
    await settle(page, 2500)
    // 그래프 오른쪽 부분에 포인터를 올려 툴팁을 띄웁니다.
    const graph = history.getByRole('group', { name: /이력 그래프/ })
    const box = await graph.boundingBox()
    if (box) await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.45)
    await page.waitForTimeout(800)
    await shoot(history, 'history')
  })
})

test.describe('탈것 상세', () => {
  // 턴테이블이 저절로 돌지 않게 해 "처음 시점"에서 찍습니다.
  test.use({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })

  test('실차 신호의 엔진오일 과열 경고', async ({ page, baseURL }) => {
    // 실차 신호 흉내: 아벤타도르(kao-0002)에 엔진오일 과열을 보냅니다.
    const demo = spawn(
      process.execPath,
      ['scripts/live-demo.mjs', '--url', baseURL!, '--vehicle', 'kao-0002', '--fault', 'oil', '--seconds', '120'],
      { env: { ...process.env, INGEST_TOKEN: 'e2e-ingest-token' }, stdio: 'ignore' },
    )
    try {
      await loginAs(page, 'operator')
      await page.goto('/fleet/kao-0002')
      await waitForHydration(page)
      await expect(page.locator('section.vehicle__issues')).toContainText(/엔진오일/, { timeout: 90_000 })
      await page.getByRole('button', { name: '처음 시점' }).first().click()
      await settle(page, 1500)
      await shoot(page, 'vehicle')
    } finally {
      demo.kill()
    }
  })
})

test.describe('모바일', () => {
  // Pixel 7과 같은 화면 크기(브라우저 종류는 바꾸지 않음)
  const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices['Pixel 7']
  test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent })

  test('관제 센터', async ({ page }) => {
    await loginAs(page, 'operator')
    await page.goto('/fleet')
    await waitForHydration(page)
    await settle(page, 4000)
    await shoot(page, 'mobile')
  })
})
