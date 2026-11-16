import { describe, expect, it } from 'vitest'
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword, verifyPasswordSync } from './password'
import { decodeSessionCookie, encodeSessionCookie, sessionId } from './session'
import { createMemoryStore } from './store/memory'

describe('세션 쿠키', () => {
  it('서명한 토큰은 풀리고, 고치면 거절합니다', () => {
    const value = encodeSessionCookie('token-abc')
    expect(decodeSessionCookie(value)).toBe('token-abc')
    expect(decodeSessionCookie(`${value}x`)).toBeNull()
    expect(decodeSessionCookie(value.replace('token-abc', 'token-abd'))).toBeNull()
    expect(decodeSessionCookie('no-signature')).toBeNull()
    expect(decodeSessionCookie(undefined)).toBeNull()
  })

  it('저장소에는 토큰이 아니라 토큰의 SHA-256을 씁니다', () => {
    expect(sessionId('token-abc')).toMatch(/^[0-9a-f]{64}$/)
    expect(sessionId('token-abc')).not.toContain('token')
  })
})

describe('비밀번호', () => {
  it('scrypt로 해시하고 맞는 비밀번호만 통과합니다(요청용은 비동기, 스크립트용은 동기)', async () => {
    const stored = hashPassword('kao-demo-2026')
    expect(stored.startsWith('scrypt$')).toBe(true)
    expect(await verifyPassword('kao-demo-2026', stored)).toBe(true)
    expect(await verifyPassword('wrong', stored)).toBe(false)
    expect(verifyPasswordSync('kao-demo-2026', stored)).toBe(true)
    expect(verifyPasswordSync('wrong', stored)).toBe(false)
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false)
  })

  it('없는 아이디에 쓰는 가짜 해시는 데모 비밀번호와도 맞지 않고, 진짜 해시와 같은 길이입니다', async () => {
    expect(await verifyPassword('kao-demo-2026', DUMMY_PASSWORD_HASH)).toBe(false)
    expect(DUMMY_PASSWORD_HASH.split('$').map((part) => part.length)).toEqual(hashPassword('x').split('$').map((part) => part.length))
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

  it('세션은 끝나기 전까지만 계정을 돌려주고, 지우면 그 세션만 끝납니다', async () => {
    const store = createMemoryStore()
    await store.createSession({ id: 's1', userId: 'user-operator', createdAt: 0, expiresAt: 1000 })
    await store.createSession({ id: 's2', userId: 'user-operator', createdAt: 0, expiresAt: 1000 })
    expect((await store.findSessionUser('s1', 999))?.login).toBe('operator')
    expect(await store.findSessionUser('s1', 1000)).toBeNull()
    await store.deleteSession('s1')
    expect(await store.findSessionUser('s1', 10)).toBeNull()
    expect((await store.findSessionUser('s2', 10))?.login).toBe('operator')
  })

  it('로그인 실패를 키마다 기간 안에서 세고, 지우면 그 키만 비웁니다', async () => {
    const store = createMemoryStore()
    await store.recordLoginFailure(['login:a|1', 'ip:1'], 100)
    await store.recordLoginFailure(['login:b|1', 'ip:1'], 200)
    expect(await store.countLoginFailures(['login:a|1', 'ip:1'], 0)).toEqual({ 'login:a|1': 1, 'ip:1': 2 })
    expect(await store.countLoginFailures(['login:a|1', 'ip:1'], 150)).toEqual({ 'ip:1': 1 })
    await store.clearLoginFailures('login:a|1')
    expect(await store.countLoginFailures(['login:a|1', 'ip:1'], 0)).toEqual({ 'ip:1': 2 })
  })
})
