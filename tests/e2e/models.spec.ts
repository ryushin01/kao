import { expect, test } from '@playwright/test'

test.describe('실제 3D 모델', () => {
  test.use({ reducedMotion: 'reduce' })

  test('탈것 상세는 원본 GLB, 관제 지도는 가벼운 GLB를 받아 오류 없이 그립니다', async ({ page }) => {
    test.slow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    // 요청을 시작했는지(requested)와 다 받았는지(loaded)를 따로 셉니다. 응답이 늦게 오는 요청도 '미리 받지 않음' 검사에 걸리게 합니다.
    const requested: string[] = []
    const loaded: string[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('.glb')) requested.push(new URL(request.url()).pathname)
    })
    page.on('response', (response) => {
      if (response.url().endsWith('.glb') && response.status() < 400) loaded.push(new URL(response.url()).pathname)
    })

    const login = await page.request.post('/api/auth/login', { data: { login: 'operator', password: 'kao-demo-2026' } })
    expect(login.ok()).toBe(true)
    await page.goto('/fleet/kao-0002')
    // CPU로 그리는 CI에서는 three.js를 불러와 첫 모델을 그리는 데 몇 초 걸립니다.
    await expect.poll(() => loaded, { timeout: 30_000 }).toContain('/models/lamborghini-aventador.glb')
    // 관제 지도는 화면 아래쪽에 있어, 다가가기 전에는 지도용 모델을 받지 않습니다.
    expect(requested).not.toContain('/models/lamborghini-aventador.lite.glb')
    await page.getByRole('img', { name: /관제 지도/ }).scrollIntoViewIfNeeded()
    await expect.poll(() => loaded, { timeout: 45_000 }).toContain('/models/lamborghini-aventador.lite.glb')
    await expect(page.getByRole('img', { name: /Lamborghini Aventador 미니어처/ })).toBeVisible()
    // 모델 출처(CC BY 4.0)는 README 표에 있고, 바닥글은 그 표로 잇습니다.
    await expect(page.getByRole('contentinfo').getByRole('link', { name: '3D 모델 출처 (README)' })).toHaveAttribute('href', 'https://github.com/ryushin01/kao#출처')
    expect(errors).toEqual([])
  })

  test('소개 화면은 미니어처 챕터에 다가가기 전에는 3D 모델을 받지 않습니다', async ({ page }) => {
    test.slow()
    const requested: string[] = []
    const loaded: string[] = []
    page.on('request', (request) => {
      if (request.url().endsWith('.glb')) requested.push(new URL(request.url()).pathname)
    })
    page.on('response', (response) => {
      if (response.url().endsWith('.glb') && response.status() < 400) loaded.push(new URL(response.url()).pathname)
    })
    await page.goto('/')
    await page.waitForFunction(() => (window as Window & { useNuxtApp?: () => { isHydrating?: boolean } }).useNuxtApp?.().isHydrating === false)
    await page.waitForTimeout(2000)
    expect(requested).toEqual([])
    await page.locator('#miniature').scrollIntoViewIfNeeded()
    // 분류 기본값은 슈퍼카(아벤타도르)입니다.
    await expect.poll(() => loaded, { timeout: 30_000 }).toContain('/models/lamborghini-aventador.glb')
  })
})
