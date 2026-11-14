// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendNotification } from 'web-push'
import { isPushEndpoint, sendTestPush } from './push'
import { useStore } from './store'

vi.mock('web-push', () => ({ setVapidDetails: vi.fn(), sendNotification: vi.fn() }))

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
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('응답하지 않는 푸시 서비스는 8초 마감에서 실패로 보고 기다리지 않습니다', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', 'test-public')
    vi.stubEnv('VAPID_PRIVATE_KEY', 'test-private')
    await useStore().savePushSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/test', p256dh: 'p', auth: 'a', userId: 'user-operator' })

    vi.mocked(sendNotification).mockResolvedValueOnce({ statusCode: 201, body: '', headers: {} })
    expect(await sendTestPush('user-operator')).toBe(1)

    vi.useFakeTimers()
    vi.mocked(sendNotification).mockReturnValueOnce(new Promise(() => {}))
    const pending = sendTestPush('user-operator')
    await vi.advanceTimersByTimeAsync(8000)
    expect(await pending).toBe(0)
  })
})
