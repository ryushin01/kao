// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VEHICLE_SPECS } from './fleet-specs'
import { invalidateLiveCaches } from './fleet'
import { isPushEndpoint, notifyCriticalIssues, PUSH_DEADLINE_MS, sendTestPush } from './push'
import { liveIssueId } from './sim/live'
import { useStore } from './store'

vi.mock('web-push', () => ({
  setVapidDetails: vi.fn(),
  generateRequestDetails: vi.fn((subscription: { endpoint: string }) => ({
    method: 'POST',
    headers: { TTL: '600' },
    body: Buffer.from('encrypted'),
    endpoint: subscription.endpoint,
  })),
}))

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/test'

describe('isPushEndpoint', () => {
  it('브라우저 푸시 서비스 주소만 받습니다', () => {
    expect(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true)
    expect(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true)
    expect(isPushEndpoint('https://web.push.apple.com/QG')).toBe(true)
    expect(isPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=abc')).toBe(true)
  })

  it('내부망·다른 사이트·http·포트 지정 주소는 거절합니다(SSRF 방지)', () => {
    for (const url of [
      'https://127.0.0.1/hook',
      'https://169.254.169.254/latest/meta-data',
      'https://example.com/push',
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com:8443/fcm/send/abc',
      'https://fcm.googleapis.com.evil.example/x',
      'not a url',
    ]) {
      expect(isPushEndpoint(url), url).toBe(false)
    }
  })
})

describe('푸시 보내기', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', 'test-public')
    vi.stubEnv('VAPID_PRIVATE_KEY', 'test-private')
    vi.stubGlobal('fetch', fetchMock)
    await useStore().savePushSubscription({ endpoint: ENDPOINT, p256dh: 'p', auth: 'a', userId: 'user-operator' })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    fetchMock.mockReset()
  })

  /** 응답하지 않다가, 끊기면(abort) 그 이유로 실패하는 푸시 서비스 */
  const hang = () =>
    fetchMock.mockImplementation(
      (_url, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))),
    )

  it('허용한 주소로 리다이렉트 없이 보내고, 201이면 보낸 것으로 셉니다', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }))
    expect(await sendTestPush('user-operator')).toBe(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(ENDPOINT)
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
  })

  it('응답하지 않는 푸시 서비스는 마감에서 요청을 끊고 실패로 봅니다', async () => {
    vi.useFakeTimers()
    hang()
    const pending = sendTestPush('user-operator')
    await vi.advanceTimersByTimeAsync(PUSH_DEADLINE_MS)
    expect(await pending).toBe(0)
    const signal = fetchMock.mock.calls[0]![1]!.signal!
    expect(signal.aborted).toBe(true)
  })

  it('위험 알림을 보내지 못하면 전송 기록을 풀어 다음 검사 때 다시 보내고, 보냈으면 다시 보내지 않습니다', async () => {
    const store = useStore()
    // 시각에 따라 생기는 다른 탈것의 시뮬레이션 문제와 섞이지 않게, G80 회원(member01)의 구독으로만 봅니다.
    await store.deletePushSubscription(ENDPOINT, 'user-operator')
    const MEMBER_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/member01'
    await store.savePushSubscription({ endpoint: MEMBER_ENDPOINT, p256dh: 'p', auth: 'a', userId: 'user-member01' })
    const g80 = VEHICLE_SPECS.find((vehicle) => vehicle.id === 'kao-0001')!
    const now = Date.now()
    const issue = { id: liveIssueId(g80.id, 'coolant', now - 5000), vehicleId: g80.id, metricKey: 'coolant', severity: 'critical' as const, detectedAt: now - 5000, clearedAt: null, resolvedAt: null, checkedAt: now - 1000 }
    await store.insertReading({ vehicleId: g80.id, at: now - 1000, metrics: { coolant: 118 } })
    await store.insertLiveIssue(issue)
    invalidateLiveCaches()

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    hang()
    const pending = notifyCriticalIssues(now)
    await vi.advanceTimersByTimeAsync(PUSH_DEADLINE_MS)
    expect(await pending).toMatchObject({ sent: 0 })
    expect(fetchMock.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true)
    // 풀렸으므로 다시 차지할 수 있습니다.
    expect(await store.claimDelivery(issue.id, MEMBER_ENDPOINT)).toBe(true)
    await store.releaseDelivery(issue.id, MEMBER_ENDPOINT)

    fetchMock.mockReset()
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }))
    expect(await notifyCriticalIssues(now)).toMatchObject({ sent: 1 })
    expect(await store.claimDelivery(issue.id, MEMBER_ENDPOINT)).toBe(false)
  })
})
