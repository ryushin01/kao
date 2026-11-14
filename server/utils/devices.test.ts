// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { authenticateToken, createDeviceToken, DEVICE_TOKEN_PREFIX, hashToken, vehicleIdFor } from './devices'
import { useStore } from './store'
import type { DeviceRecord } from './store/types'

const device = (token: string, overrides: Partial<DeviceRecord> = {}): DeviceRecord => ({
  id: `dev-${hashToken(token).slice(0, 8)}`,
  vehicleId: 'kao-0002',
  name: '시험 장치',
  tokenHash: hashToken(token),
  createdAt: 0,
  revokedAt: null,
  lastSeenAt: null,
  webhookUrl: null,
  webhookSecret: null,
  ...overrides,
})
const status = (promise: Promise<unknown>) => promise.then(() => 200, (error: { statusCode?: number }) => error.statusCode ?? 500)

describe('장치 토큰 인증', () => {
  const previous = process.env.INGEST_TOKEN
  beforeEach(() => {
    process.env.INGEST_TOKEN = 'fleet-secret'
  })
  afterEach(() => {
    process.env.INGEST_TOKEN = previous
  })

  it('장치 토큰은 앞머리가 붙은 무작위 값이고, 저장소에는 SHA-256만 둡니다', () => {
    const token = createDeviceToken()
    expect(token.startsWith(DEVICE_TOKEN_PREFIX)).toBe(true)
    expect(token.length).toBeGreaterThan(40)
    expect(createDeviceToken()).not.toBe(token)
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('공용 토큰은 모든 탈것을, 장치 토큰은 자기 탈것만 보낼 수 있습니다', async () => {
    const store = useStore()
    const token = createDeviceToken()
    await store.insertDevice(device(token))

    expect(await authenticateToken('Bearer fleet-secret')).toEqual({ kind: 'fleet' })
    const principal = await authenticateToken(`Bearer ${token}`, 1_000)
    expect(principal).toMatchObject({ kind: 'device', device: { vehicleId: 'kao-0002' } })
    // 마지막 요청 시각을 남깁니다.
    expect((await store.findDeviceByTokenHash(hashToken(token)))!.lastSeenAt).toBe(1_000)

    expect(vehicleIdFor({ kind: 'fleet' }, 'kao-0001')).toBe('kao-0001')
    // vehicleId를 빼면 장치의 탈것
    expect(vehicleIdFor(principal, undefined)).toBe('kao-0002')
    expect(vehicleIdFor(principal, 'kao-0002')).toBe('kao-0002')
    expect(() => vehicleIdFor(principal, 'kao-0001')).toThrowError(/kao-0002 전용/)
  })

  it('없는 토큰·폐기한 장치 토큰·형식이 틀린 헤더는 401입니다', async () => {
    const store = useStore()
    const token = createDeviceToken()
    const record = device(token)
    await store.insertDevice(record)
    expect(await store.revokeDevice(record.id, 2_000)).toBe(true)
    expect(await store.revokeDevice(record.id, 3_000)).toBe(false)

    expect(await status(authenticateToken(`Bearer ${token}`))).toBe(401)
    expect(await status(authenticateToken(`Bearer ${createDeviceToken()}`))).toBe(401)
    expect(await status(authenticateToken('Bearer wrong'))).toBe(401)
    expect(await status(authenticateToken('fleet-secret'))).toBe(401)
    expect(await status(authenticateToken(undefined))).toBe(401)
  })

  it('공용 토큰이 설정되지 않았으면 장치 토큰만 받습니다', async () => {
    delete process.env.INGEST_TOKEN
    expect(await status(authenticateToken('Bearer fleet-secret'))).toBe(401)
    expect(await status(authenticateToken('Bearer '))).toBe(401)
  })
})
