import { expect, test } from './fixtures'

type RestoreWindow = Window & { restoreEventHorizon?: () => void }

test('블랙홀 배경은 WebGL 컨텍스트를 잃었다가 되찾으면 다시 그립니다', async ({ page }) => {
  await page.goto('/')
  const canvas = page.locator('.event-horizon__canvas')
  await expect(canvas).toBeVisible()
  // 셰이더는 화면 전체에 잡음 무늬를 그려 스크린샷(PNG)이 큽니다. 지워진 캔버스는 배경색만 남아 아주 작습니다.
  const size = async () => (await canvas.screenshot()).length
  await expect.poll(size).toBeGreaterThan(100_000)
  const drawn = await size()

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const element = document.querySelector<HTMLCanvasElement>('.event-horizon__canvas')!
        const gl = element.getContext('webgl2') ?? element.getContext('webgl')
        const extension = gl!.getExtension('WEBGL_lose_context')!
        element.addEventListener('webglcontextlost', () => resolve(), { once: true })
        ;(window as RestoreWindow).restoreEventHorizon = () => extension.restoreContext()
        extension.loseContext()
      }),
  )
  await expect.poll(size).toBeLessThan(drawn / 4)

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const element = document.querySelector<HTMLCanvasElement>('.event-horizon__canvas')!
        element.addEventListener('webglcontextrestored', () => resolve(), { once: true })
        ;(window as RestoreWindow).restoreEventHorizon!()
      }),
  )
  await expect.poll(size, { timeout: 10_000 }).toBeGreaterThan(drawn / 2)
})
