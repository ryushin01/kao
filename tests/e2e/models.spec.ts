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
    const tracked = (url: string) => url.endsWith('.glb') || url.endsWith('/maps/seoul.json')
    page.on('request', (request) => {
      if (tracked(request.url())) requested.push(new URL(request.url()).pathname)
    })
    page.on('response', (response) => {
      if (tracked(response.url()) && response.status() < 400) loaded.push(new URL(response.url()).pathname)
    })
    const workers: string[] = []
    page.on('worker', (worker) => workers.push(worker.url()))

    const login = await page.request.post('/api/auth/login', { data: { login: 'operator', password: 'kao-demo-2026' } })
    expect(login.ok()).toBe(true)
    await page.goto('/fleet/kao-0002')
    // CPU로 그리는 CI에서는 three.js를 불러와 첫 모델을 그리는 데 몇 초 걸립니다.
    await expect.poll(() => loaded, { timeout: 30_000 }).toContain('/models/lamborghini-aventador.glb')
    // 관제 지도는 화면 아래쪽에 있어, 다가가기 전에는 지도용 모델과 서울 지도 데이터를 받지 않습니다.
    expect(requested).not.toContain('/models/lamborghini-aventador.lite.glb')
    expect(requested).not.toContain('/maps/seoul.json')
    await page.getByRole('img', { name: /관제 지도/ }).scrollIntoViewIfNeeded()
    await expect.poll(() => loaded, { timeout: 45_000 }).toContain('/models/lamborghini-aventador.lite.glb')
    await expect.poll(() => loaded, { timeout: 45_000 }).toContain('/maps/seoul.json')
    // 서울 지도 데이터는 웹 워커가 받아 도형으로 만듭니다(메인 스레드를 막지 않음).
    expect(workers.some((url) => url.includes('seoul-map.worker'))).toBe(true)
    await expect(page.getByRole('img', { name: /Lamborghini Aventador 미니어처/ })).toBeVisible()
    // 모델(CC BY 4.0)과 지도 데이터(ODbL) 출처는 README 표에 있고, 바닥글은 그 표로 잇습니다.
    await expect(page.getByRole('contentinfo').getByRole('link', { name: '3D 모델·지도 데이터 출처 (README)' })).toHaveAttribute(
      'href',
      'https://github.com/ryushin01/kao#출처',
    )
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
