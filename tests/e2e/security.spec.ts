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
