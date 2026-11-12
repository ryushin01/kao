import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password'
import { decodeSession, encodeSession } from './session'
import { createMemoryStore } from './store/memory'

describe('세션 쿠키', () => {
  it('서명한 값은 풀리고, 고치거나 만료되면 거절합니다', () => {
    const now = Date.UTC(2026, 10, 12)
    const value = encodeSession('user-operator', now)
    expect(decodeSession(value, now + 1000)).toBe('user-operator')
    expect(decodeSession(`${value}x`, now)).toBeNull()
    const [payload] = value.split('.')
    const forged = Buffer.from(JSON.stringify({ uid: 'user-member01', exp: now + 1e9 })).toString('base64url')
    expect(decodeSession(value.replace(payload!, forged), now)).toBeNull()
    expect(decodeSession(value, now + 8 * 24 * 3600_000)).toBeNull()
  })
})

describe('비밀번호', () => {
  it('scrypt로 해시하고 맞는 비밀번호만 통과합니다', () => {
    const stored = hashPassword('kao-demo-2026')
    expect(stored.startsWith('scrypt$')).toBe(true)
    expect(verifyPassword('kao-demo-2026', stored)).toBe(true)
    expect(verifyPassword('wrong', stored)).toBe(false)
  })
})

describe('메모리 저장소', () => {
  it('데모 계정을 갖고, 같은 문제의 두 번째 조치와 같은 구독에 같은 알림을 막고, 실패하면 다시 보낼 수 있게 합니다', async () => {
    const store = createMemoryStore()
    expect((await store.findUserByLogin('member03'))?.vehicleIds).toEqual(['kao-0003'])
    const action = { id: 'a', issueId: 'i', vehicleId: 'kao-0001', action: 'notify-rider' as const, sentAt: 1, userId: 'u' }
    expect(await store.insertAction(action)).toBe(true)
    expect(await store.insertAction({ ...action, id: 'b' })).toBe(false)
    expect(await store.claimDelivery('i', 'https://fcm.googleapis.com/a')).toBe(true)
    expect(await store.claimDelivery('i', 'https://fcm.googleapis.com/a')).toBe(false)
    expect(await store.claimDelivery('i', 'https://fcm.googleapis.com/b')).toBe(true)
    await store.releaseDelivery('i', 'https://fcm.googleapis.com/a')
    expect(await store.claimDelivery('i', 'https://fcm.googleapis.com/a')).toBe(true)
  })
})
