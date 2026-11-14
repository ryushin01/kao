import type { APIRequestContext } from '@playwright/test'
import { findRoute } from '../../src/shared/config/routes'
import { createRouteGeo } from '../../src/shared/lib/route-geo'
import { expect, loginAs, test } from './fixtures'

/** playwright.config.ts의 webServer가 넘기는 수신 토큰 */
const headers = { Authorization: 'Bearer e2e-ingest-token' }
const G80_ROUTE = createRouteGeo(findRoute('downtown'))

interface Command {
  id: string
  action: string
  label: string
}

async function sendTelemetry(request: APIRequestContext, data: Record<string, unknown>) {
  const response = await request.post('/api/ingest/telemetry', { headers, data: { vehicleId: 'kao-0001', ...data } })
  expect(response.status(), await response.text()).toBe(200)
  return (await response.json()) as { position: { onRoute: boolean; lap: number } | null; commands: Command[] }
}

test('수신 API는 토큰·지표·GPS·명령 id를 확인합니다', async ({ request }) => {
  expect((await request.post('/api/ingest/telemetry', { data: { vehicleId: 'kao-0001' } })).status()).toBe(401)
  const unknownMetric = await request.post('/api/ingest/telemetry', { headers, data: { vehicleId: 'kao-0001', metrics: { oil: 120 } } })
  expect(unknownMetric.status()).toBe(422)
  const halfGps = await request.post('/api/ingest/telemetry', { headers, data: { vehicleId: 'kao-0004', lat: 37.5 } })
  expect(halfGps.status()).toBe(422)
  const ack = await request.post('/api/ingest/commands/nope/ack', { headers, data: { vehicleId: 'kao-0001', result: 'applied' } })
  expect(ack.status()).toBe(404)
  const commands = await request.get('/api/ingest/commands?vehicleId=kao-0004', { headers })
  expect(await commands.json()).toEqual({ vehicleId: 'kao-0004', commands: [] })
})

test('실측값이 기준을 넘으면 문제를 열고, 보낸 조치를 차량이 받아 적용한 뒤 지표가 돌아오면 해결합니다', async ({ page, request }) => {
  test.slow()
  // 실차 장치처럼 2초마다 측정값과 GPS를 보냅니다. 30초 넘게 끊기면 시뮬레이션으로 돌아가기 때문입니다.
  let coolant = 109.5
  let progress = 0.2
  let running = true
  const received: Command[] = []
  const first = await sendTelemetry(request, { speed: 48, metrics: { coolant }, ...G80_ROUTE.toLatLng(progress) })
  expect(first.position).toMatchObject({ onRoute: true, lap: 1 })
  const device = (async () => {
    while (running) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      progress = (progress + 0.004) % 1
      const result = await sendTelemetry(request, { speed: 48, metrics: { coolant }, ...G80_ROUTE.toLatLng(progress) })
      received.push(...result.commands.filter((command) => !received.some((item) => item.id === command.id)))
    }
  })()

  try {
    await loginAs(page, 'operator')
    await page.goto('/fleet/kao-0001')
    await expect(page.getByText('실차 신호', { exact: true })).toBeVisible()
    // 머리말의 위치와 관제 지도 표의 '위치 기준'이 GPS를 따릅니다.
    await expect(page.getByText(/바퀴째 · \d+% · GPS 기준/)).toBeVisible()
    const row = page.getByRole('table', { name: /주행 위치 표/ }).getByRole('row', { name: /G80/ })
    await expect(row.getByRole('cell', { name: 'GPS', exact: true })).toBeVisible()
    const issues = page.getByRole('region', { name: '문제와 원격 조치' })
    const issue = issues.getByRole('article').filter({ hasText: '실차 측정' })
    await expect(issue.getByRole('heading', { name: '냉각수 과열' })).toBeVisible({ timeout: 15_000 })

    await issue.getByRole('button', { name: '냉각 모드' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '명령 보내기' }).click()
    await expect(issue.getByText('차량 응답을 기다리고 있습니다.', { exact: false })).toBeVisible()

    // 장치가 다음 측정값을 보낼 때 응답으로 명령을 받아 갑니다.
    await expect.poll(() => received.map((command) => command.action), { timeout: 10_000 }).toEqual(['cooling-mode'])
    const ack = await request.post(`/api/ingest/commands/${received[0]!.id}/ack`, { headers, data: { vehicleId: 'kao-0001', result: 'applied' } })
    expect(ack.status()).toBe(200)
    await expect(issue.getByText('차량이 명령을 적용했습니다.', { exact: false })).toBeVisible({ timeout: 10_000 })
    const log = page.getByRole('region', { name: '이 탈것의 조치 기록' })
    await expect(log.getByText('냉각 모드 차량 적용 완료', { exact: false })).toBeVisible()

    // 지표가 기준 안으로 돌아와 10초 동안 유지되면 해결됩니다.
    coolant = 92
    await expect(issues.getByText('냉각 모드로 해결', { exact: false })).toBeVisible({ timeout: 30_000 })
  } finally {
    running = false
    await device
  }
})

test('경로 밖 GPS는 실제 위치와 지나온 길(최근 2분)로 보여 주고, 등록되지 않은 장치 토큰은 받지 않습니다', async ({ page, request }) => {
  const device = await request.post('/api/ingest/telemetry', {
    headers: { Authorization: 'Bearer kaod_not-registered' },
    data: { vehicleId: 'kao-0004', speed: 15 },
  })
  expect(device.status()).toBe(401)

  // 스트라이다를 경로(여의도 한강 자전거길)에서 몇 km 떨어진 강남역 근처로 보냅니다.
  const points = [
    { lat: 37.4979, lng: 127.0256 },
    { lat: 37.4982, lng: 127.0266 },
    { lat: 37.4985, lng: 127.0276 },
  ]
  for (const point of points) {
    const response = await request.post('/api/ingest/telemetry', { headers, data: { vehicleId: 'kao-0004', speed: 15, metrics: {}, ...point } })
    expect(response.status(), await response.text()).toBe(200)
    expect((await response.json()).position).toMatchObject({ onRoute: false })
  }

  await loginAs(page, 'operator')
  await page.goto('/fleet')
  const row = page.getByRole('table', { name: /주행 위치 표/ }).getByRole('row', { name: /STRiDA LT/ })
  await expect(row.getByRole('cell', { name: 'GPS 경로 밖(실제 위치)' })).toBeVisible()
  // 경로 밖이면 바퀴 수·진행률(시뮬레이션 값)은 내지 않습니다.
  await expect(row.getByRole('cell', { name: '—', exact: true })).toHaveCount(2)
  const frame = (await (await page.request.get('/api/fleet')).json()) as { vehicles: Array<{ id: string; gps: { onRoute: boolean; trail: number[][] } | null }> }
  const strida = frame.vehicles.find((vehicle) => vehicle.id === 'kao-0004')!
  expect(strida.gps).toMatchObject({ onRoute: false })
  expect(strida.gps!.trail.slice(-3)).toEqual(points.map((point) => [point.lat, point.lng]))
})
