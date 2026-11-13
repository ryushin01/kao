import { expect, test } from '@playwright/test'

test.describe('실제 3D 모델', () => {
  test.use({ reducedMotion: 'reduce' })

  test('탈것 상세는 원본 GLB, 관제 지도는 가벼운 GLB를 받아 오류 없이 그립니다', async ({ page }) => {
    test.slow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const loaded: string[] = []
    page.on('response', (response) => {
      if (response.url().endsWith('.glb') && response.ok()) loaded.push(new URL(response.url()).pathname)
    })

    await page.goto('/fleet/kao-0002')
    // CPU로 그리는 CI에서는 첫 모델을 그리는 동안 다음 위젯이 늦게 뜹니다.
    await expect.poll(() => loaded, { timeout: 15_000 }).toContain('/models/lamborghini-aventador.glb')
    await expect.poll(() => loaded, { timeout: 15_000 }).toContain('/models/lamborghini-aventador.lite.glb')
    await expect(page.getByRole('img', { name: /Lamborghini Aventador 미니어처/ })).toBeVisible()
    await expect(page.getByRole('contentinfo').getByRole('link', { name: /2022 Lamborghini Aventador LP780-4 Ultimae/ })).toBeVisible()
    expect(errors).toEqual([])
  })
})
