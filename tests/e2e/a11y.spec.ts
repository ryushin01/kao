import AxeBuilder from '@axe-core/playwright'
import { expect, test } from './fixtures'

const pages = ['/', '/fleet', '/fleet/kao-0003']

for (const path of pages) {
  test(`${path}: axe 위반이 없고 기본 언어·제목·본문 바로가기가 있습니다`, async ({ page }) => {
    await page.goto(path)
    await expect(page.locator('html')).toHaveAttribute('lang', 'ko')
    await expect(page).toHaveTitle(/KAO/)
    await expect(page.locator('h1')).toHaveCount(1)

    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: '본문 바로가기' })
    await expect(skip).toBeFocused()

    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  })

  test(`${path}: 가로로 넘치지 않습니다`, async ({ page }) => {
    await page.goto(path)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
}
