import { expect, test } from './fixtures'

test('화면·API·정적 파일 응답에 보안 헤더가 있고 X-Powered-By가 없습니다', async ({ request }) => {
  for (const path of ['/', '/login', '/api/showroom', '/favicon.svg']) {
    const headers = (await request.get(path)).headers()
    expect(headers['x-frame-options'], path).toBe('DENY')
    expect(headers['content-security-policy'], path).toContain("frame-ancestors 'none'")
    expect(headers['x-content-type-options'], path).toBe('nosniff')
    expect(headers['referrer-policy'], path).toBe('strict-origin-when-cross-origin')
    expect(headers['permissions-policy'], path).toContain('camera=()')
    expect(headers['x-powered-by'], path).toBeUndefined()
  }
})

test('다른 사이트나 Origin: null에서 온 로그인은 403입니다', async ({ request }) => {
  for (const origin of ['null', 'https://evil.example']) {
    const response = await request.post('/api/auth/login', {
      data: { login: 'operator', password: 'kao-demo-2026' },
      headers: { origin },
    })
    expect(response.status(), origin).toBe(403)
  }
})

test('웹 앱 매니페스트·아이콘·robots·공유 미리보기를 제공합니다', async ({ page, request }) => {
  const manifest = await request.get('/manifest.webmanifest')
  expect(manifest.ok()).toBe(true)
  expect(manifest.headers()['content-type']).toContain('manifest+json')
  const body = (await manifest.json()) as { display: string; start_url: string; icons: Array<{ src: string; sizes: string; purpose?: string }> }
  expect(body.display).toBe('standalone')
  expect(body.start_url).toBe('/fleet')
  for (const icon of [...body.icons.map((item) => item.src), '/badge-96.png', '/og-image.jpg']) {
    const response = await request.get(icon)
    expect(response.ok(), icon).toBe(true)
    expect(response.headers()['cache-control'], icon).toContain('max-age=86400')
  }
  expect(body.icons.some((icon) => icon.purpose === 'maskable')).toBe(true)

  const robots = await (await request.get('/robots.txt')).text()
  expect(robots).toContain('Disallow: /fleet')
  expect(robots).toContain('Disallow: /api/')

  await page.goto('/')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest')
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /^https:\/\/.+\/og-image\.jpg$/)
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image')
})
