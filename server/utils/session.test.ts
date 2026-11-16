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

  it('로그인 시도를 키마다 하나씩 올려 세고, 창이 지나면 1부터, 되돌리면 하나 내리고, 지우면 그 키만 비웁니다', async () => {
    const store = createMemoryStore()
    const counts = async (keys: string[], now: number) =>
      Object.fromEntries(Object.entries(await store.reserveLoginAttempt(keys, now, 1000)).map(([key, value]) => [key, value.count]))
    expect(await counts(['login:a|1', 'ip:1'], 100)).toEqual({ 'login:a|1': 1, 'ip:1': 1 })
    expect(await counts(['login:b|1', 'ip:1'], 200)).toEqual({ 'login:b|1': 1, 'ip:1': 2 })
    await store.releaseLoginAttempt('ip:1', 100)
    await store.resetLoginAttempts('login:a|1')
    expect(await counts(['login:a|1', 'ip:1'], 300)).toEqual({ 'login:a|1': 1, 'ip:1': 2 })
    // 창(1000ms)이 지나면 다시 1부터('ip:1'은 100에, 'login:a|1'은 지운 뒤 300에 창이 시작됨)
    expect(await counts(['login:a|1', 'ip:1'], 1200)).toEqual({ 'login:a|1': 2, 'ip:1': 1 })
    expect(await counts(['login:a|1'], 1400)).toEqual({ 'login:a|1': 1 })
  })

  it('확인하는 사이 창이 바뀌면, 이전 창의 성공한 시도로 새 창의 수를 줄이지 않습니다', async () => {
    const store = createMemoryStore()
    const old = await store.reserveLoginAttempt(['ip:9'], 0, 1000)
    // 이전 창의 요청이 비밀번호를 확인하는 사이 창이 지나, 다른 요청이 새 창을 열고 실패했습니다.
    const fresh = await store.reserveLoginAttempt(['ip:9'], 1500, 1000)
    expect(fresh['ip:9']).toEqual({ count: 1, windowStart: 1500 })
    await store.releaseLoginAttempt('ip:9', old['ip:9']!.windowStart)
    expect((await store.reserveLoginAttempt(['ip:9'], 1600, 1000))['ip:9']).toEqual({ count: 2, windowStart: 1500 })
    // 같은 창의 시도는 되돌립니다.
    await store.releaseLoginAttempt('ip:9', 1500)
    expect((await store.reserveLoginAttempt(['ip:9'], 1700, 1000))['ip:9']!.count).toBe(2)
  })
})
