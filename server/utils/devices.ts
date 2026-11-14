import { timingSafeEqual } from 'node:crypto'
import { createError, getRequestHeader } from 'h3'
import type { H3Event } from 'h3'
import { DEVICE_TOKEN_PREFIX, hashToken } from './device-token'
import { useStore } from './store'
import type { DeviceRecord } from './store/types'

export { createDeviceToken, createWebhookSecret, DEVICE_TOKEN_PREFIX, hashToken } from './device-token'

/**
 * 실차 수신 API의 인증. 장치 토큰(`kaod_…`)은 탈것 하나에 묶이고, 저장소에는 토큰의 SHA-256만 둡니다.
 * 공용 토큰(INGEST_TOKEN)은 모든 탈것을 보낼 수 있는 개발·시험용입니다(데모 장치, E2E).
 */

/** 장치의 마지막 요청 시각은 인스턴스마다 이 간격(ms)으로만 기록합니다(측정값마다 DB에 쓰지 않게). */
const TOUCH_INTERVAL_MS = 60_000


/** 인증한 쪽: 공용 토큰(모든 탈것) 또는 탈것 하나에 묶인 장치 */
export type IngestPrincipal = { kind: 'fleet' } | { kind: 'device'; device: DeviceRecord }

const sameText = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const touched = new Map<string, number>()

/** Authorization 헤더 값으로 인증합니다. 맞지 않으면 401 */
export async function authenticateToken(authorization: string | undefined, now = Date.now()): Promise<IngestPrincipal> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  // 공용 토큰을 먼저 봅니다(공용 토큰 값이 장치 토큰 앞머리로 시작해도 공용 토큰으로 인정).
  const fleetToken = process.env.INGEST_TOKEN
  if (fleetToken && token && sameText(token, fleetToken)) return { kind: 'fleet' }
  if (token.startsWith(DEVICE_TOKEN_PREFIX)) {
    const store = useStore()
    const device = await store.findDeviceByTokenHash(hashToken(token))
    if (device) {
      const last = touched.get(device.id)
      if (last === undefined || now - last >= TOUCH_INTERVAL_MS) {
        touched.set(device.id, now)
        // 마지막 요청 시각은 덤이라, 기록하지 못해도 요청은 받습니다(1분 뒤 다시 기록).
        await store.touchDevice(device.id, now).catch(() => undefined)
      }
      return { kind: 'device', device }
    }
  }
  throw createError({ statusCode: 401, message: '인증되지 않은 요청입니다. 장치 토큰(Authorization: Bearer kaod_…)을 확인해 주세요.' })
}

export function authenticateIngest(event: H3Event) {
  return authenticateToken(getRequestHeader(event, 'authorization'))
}

/** 장치 토큰은 자기 탈것만 보낼 수 있습니다(403). vehicleId를 빼면 장치의 탈것으로 봅니다. */
export function vehicleIdFor(principal: IngestPrincipal, vehicleId: unknown) {
  if (principal.kind === 'fleet') return vehicleId
  if (vehicleId === undefined || vehicleId === null || vehicleId === '') return principal.device.vehicleId
  if (vehicleId !== principal.device.vehicleId) {
    throw createError({ statusCode: 403, message: `이 장치 토큰은 ${principal.device.vehicleId} 전용입니다. vehicleId를 확인해 주세요.` })
  }
  return vehicleId
}
