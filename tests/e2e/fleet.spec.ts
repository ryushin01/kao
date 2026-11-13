import { expect, test } from './fixtures'

test('관제 센터는 4대를 실시간으로 받아 표와 카드로 보여 줍니다', async ({ page }) => {
  await page.goto('/fleet')
  await expect(page.getByRole('heading', { level: 1, name: '관제 센터' })).toBeVisible()
  await expect(page.getByRole('table', { name: '주행 위치 표' }).locator('tbody tr')).toHaveCount(4)
  await expect(page.getByText('실시간 수신 중')).toBeVisible()
  await expect(page.getByRole('img', { name: /관제 지도/ })).toBeVisible()
})

test('조치 대기열에서 원격 조치를 확인하고 보내면 조치 중을 거쳐 해결됩니다', async ({ page }) => {
  await page.goto('/fleet')
  const queue = page.getByRole('region', { name: '조치 대기열' })
  const issue = queue.getByRole('article').first()
  const title = await issue.getByRole('heading', { level: 3 }).textContent()
  await issue.getByRole('list', { name: '원격 조치' }).getByRole('button').first().click()

  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '명령 보내기' }).dblclick()
  await expect(dialog).toBeHidden()

  // '명령을 보냈습니다' 알림은 카드 안에 있어, 조치가 빨리 끝나 카드가 사라지면 함께 사라집니다.
  // 그래서 여기서는 남는 조치 기록으로 확인하고, 알림 문구는 RemoteActionPanel 단위 테스트가 확인합니다.
  const log = page.getByRole('region', { name: '원격 조치 기록' })
  await expect(log.getByText(`${title}`).first()).toBeVisible()
  await expect(log.getByText('완료').first()).toBeVisible({ timeout: 10_000 })
  // 두 번 눌러도 명령은 한 번만 기록됩니다.
  await expect(log.getByRole('listitem').filter({ hasText: `${title}` }).filter({ hasText: '명령 전송' })).toHaveCount(1)
})

test('카드 제목을 누르면 탈것 상세 화면으로 갑니다', async ({ page }) => {
  await page.goto('/fleet')
  // 고장이 나 조치 대기열에 오른 탈것은 같은 이름의 링크가 하나 더 생기므로, 등록 탈것 카드에서 찾습니다.
  await page.getByRole('region', { name: '등록 탈것' }).getByRole('link', { name: 'STRiDA LT' }).click()
  // CPU로 WebGL을 그리는 CI에서는 상세 화면으로 넘어가는 데 몇 초 걸립니다.
  await expect(page).toHaveURL(/\/fleet\/kao-0004$/, { timeout: 15_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'STRiDA LT' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '실시간 지표' })).toBeVisible()
})

test.describe('동작 줄이기 설정', () => {
  test.use({ reducedMotion: 'reduce' })

  test('없는 탈것은 404 화면을 보여 주고, 애니메이션은 멈춘 상태로 시작합니다', async ({ page }) => {
    const response = await page.goto('/fleet/unknown')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('사건의 지평선 너머')
    await expect(page.getByRole('button', { name: '애니메이션 정지' })).toHaveAttribute('aria-pressed', 'true')
  })
})

test('애니메이션 정지 버튼은 눌림 상태를 알립니다', async ({ page }) => {
  await page.goto('/')
  const toggle = page.getByRole('button', { name: '애니메이션 정지' })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
})
