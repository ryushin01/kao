import { expect, loginAs, test } from './fixtures'

test('로그인하지 않고 관제 센터에 가면 로그인 화면으로 보내고, 로그인하면 원래 화면으로 돌아옵니다', async ({ page }) => {
  await page.goto('/fleet')
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await page.getByLabel('아이디').fill('operator')
  await page.getByLabel('비밀번호').fill('kao-demo-2026')
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  // 로그인·로그아웃 뒤 화면 이동은 GPU 없는 CI에서 WebGL을 CPU로 그리느라 몇 초 걸릴 수 있습니다.
  await expect(page).toHaveURL(/\/fleet$/, { timeout: 15_000 })
  await expect(page.getByRole('heading', { level: 1, name: '관제 센터' })).toBeVisible()
})

test('비밀번호가 틀리면 원인과 방법을 알리고, 빈 칸은 해당 칸에 오류를 연결합니다', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page.getByLabel('아이디')).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByLabel('아이디')).toBeFocused()
  await page.getByLabel('아이디').fill('operator')
  await page.getByLabel('비밀번호').fill('wrong')
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '아이디 또는 비밀번호가 맞지 않습니다' })).toBeVisible()
})

test('회원은 자기 탈것만 보고, 원격 조치 버튼 대신 안내를 봅니다', async ({ page }) => {
  // 3D 장면이 있는 상세 화면을 세 번 오가므로 GPU 없는 환경에서는 오래 걸립니다.
  test.slow()
  await page.goto('/login')
  await page.getByRole('button', { name: /가상 회원 02/ }).click()
  await expect(page).toHaveURL(/\/fleet\/kao-0002$/, { timeout: 15_000 })
  await expect(page.getByRole('navigation', { name: '주요 메뉴' }).getByRole('link', { name: '내 탈것' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '지표 이력' })).toBeVisible()
  // 이력은 화면이 뜬 뒤 따로 받아 그립니다.
  await expect(page.getByRole('group', { name: /이력 그래프/ })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: '명령 보내기' })).toHaveCount(0)

  await page.goto('/fleet')
  await expect(page).toHaveURL(/\/fleet\/kao-0002$/)
  await page.goto('/fleet/kao-0001')
  await expect(page).toHaveURL(/\/fleet\/kao-0002$/)

  const denied = await page.request.post('/api/vehicles/kao-0002/actions', { data: { issueId: 'x', action: 'notify-rider' } })
  expect(denied.status()).toBe(403)
  const fleet = await (await page.request.get('/api/fleet')).json()
  expect(fleet.vehicles.map((vehicle: { id: string }) => vehicle.id)).toEqual(['kao-0002'])
})

test('로그아웃하면 소개 화면으로 가고 관제 데이터를 받을 수 없습니다', async ({ page }) => {
  await loginAs(page, 'operator')
  await page.goto('/fleet')
  await page.getByRole('button', { name: '로그아웃' }).click()
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })
  await expect(page.getByRole('navigation', { name: '주요 메뉴' }).getByRole('link', { name: '로그인' })).toBeVisible()
  expect((await page.request.get('/api/fleet')).status()).toBe(401)
})
