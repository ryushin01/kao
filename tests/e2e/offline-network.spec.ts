import AxeBuilder from '@axe-core/playwright'
import { expect, loginAs, test } from './fixtures'

/**
 * 인터넷 없이 로컬에서 띄운 서버: localhost 밖 요청을 모두 막고, DATABASE_URL 없이(메모리 저장소·데모 계정) 모든 화면이
 * 내용과 함께 뜨는지 봅니다. 서울 지도(public/maps/seoul.json)·글꼴·아이콘은 저장소 안에 있고, 주행 상태는 서버 시뮬레이션이 만듭니다.
 * (한 번 연 화면을 브라우저가 연결 없이 보여 주는 검사는 offline.spec.ts)
 */
test.beforeEach(async ({ page }) => {
  await page.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    (route) => route.abort('internetdisconnected'),
  )
})

const screens = [
  { path: '/', login: null, text: /KAO/ },
  { path: '/login', login: null, text: /데모 계정/ },
  { path: '/fleet', login: 'operator', text: /관제 센터/ },
  { path: '/fleet/kao-0003', login: 'operator', text: /Ducati/ },
  { path: '/fleet', login: 'member01', text: /Genesis G80/ },
]

for (const { path, login, text } of screens) {
  test(`${path}(${login ?? '손님'}): 인터넷 없이도 내용이 보이고 axe 위반이 없습니다`, async ({ page }) => {
    // GPU 없는 CI는 관제 센터의 3D 지도를 CPU로 그려 오래 걸립니다.
    test.setTimeout(120_000)
    const errors: string[] = []
    const failed: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('requestfailed', (req) => {
      const url = new URL(req.url())
      // 3D 모델은 fixtures.ts가 일부러 막습니다.
      if (url.hostname === 'localhost' && !url.pathname.endsWith('.glb') && req.failure()?.errorText !== 'net::ERR_ABORTED') failed.push(url.pathname)
    })
    if (login) await loginAs(page, login)
    await page.goto(path)
    await expect(page.locator('h1')).toHaveCount(1)
    await expect(page.locator('main')).toContainText(text)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
    expect(failed, '사이트 안 요청 실패').toEqual([])
    expect(errors, '런타임 오류').toEqual([])
  })
}

test('서울 지도 자료는 외부 지도 서버가 아니라 사이트 안에서 받습니다', async ({ page }) => {
  const response = await page.request.get('/maps/seoul.json')
  expect(response.ok()).toBe(true)
  expect((await response.body()).byteLength).toBeGreaterThan(100_000)
})
