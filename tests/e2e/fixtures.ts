import { test as base, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * GPU 없는 CI는 CPU로 그리므로 수십만 삼각형짜리 3D 모델을 그리면 화면이 멈춘 듯 느려집니다.
 * 화면·접근성 검사는 모델 파일 요청을 막아, 받지 못했을 때 쓰는 직접 만든 모형으로 검사합니다.
 * 실제 모델을 불러오는지는 models.spec.ts에서 따로 확인합니다.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('**/models/*.glb', (route) => route.abort())
    await use(page)
  },
})

/** 데모 계정으로 로그인합니다(쿠키가 브라우저 컨텍스트에 남습니다). */
export async function loginAs(page: Page, login: string) {
  const response = await page.request.post('/api/auth/login', { data: { login, password: 'kao-demo-2026' } })
  expect(response.ok()).toBe(true)
}

export { expect }
