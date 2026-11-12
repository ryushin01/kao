import { describe, expect, it } from 'vitest'
import { isPushEndpoint } from './push'

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
