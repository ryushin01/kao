import { test as base, type Page } from '@playwright/test'

type NuxtWindow = Window & { useNuxtApp?: () => { isHydrating?: boolean } }

/**
 * 서버가 그린 화면은 Vue가 이벤트 처리기를 붙이기 전에도 보이고 누를 수 있습니다. 그때 누르면 아무 일도 일어나지 않습니다.
 * GPU 없는 CI는 WebGL을 CPU로 그려 하이드레이션이 몇 초씩 늦어지므로, 화면을 연 뒤 하이드레이션이 끝날 때까지 기다립니다.
 */
export async function waitForHydration(page: Page) {
  await page.waitForFunction(() => (window as NuxtWindow).useNuxtApp?.().isHydrating === false)
}

/**
 * GPU 없는 CI는 CPU로 그리므로 수십만 삼각형짜리 3D 모델을 그리면 화면이 멈춘 듯 느려집니다.
 * 화면·접근성 검사는 모델 파일 요청을 막아, 받지 못했을 때 쓰는 직접 만든 모형으로 검사합니다.
 * 실제 모델을 불러오는지는 models.spec.ts에서 따로 확인합니다.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('**/models/*.glb', (route) => route.abort())
    const goto = page.goto.bind(page)
    page.goto = async (...args) => {
      const response = await goto(...args)
      await waitForHydration(page)
      return response
    }
    await use(page)
  },
})

export { expect } from '@playwright/test'
