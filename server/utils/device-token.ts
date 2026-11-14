import { createHash, randomBytes } from 'node:crypto'

/**
 * 장치 토큰 형식. 서버(devices.ts)와 장치 관리 스크립트(scripts/devices.mjs)가 함께 씁니다
 * (Node가 TS 파일을 그대로 불러오도록 런타임 의존은 node:crypto만).
 */

/** 장치 토큰 앞머리. 공용 토큰(INGEST_TOKEN)과 섞이지 않게 구분합니다. */
export const DEVICE_TOKEN_PREFIX = 'kaod_'

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
export const createDeviceToken = () => `${DEVICE_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
export const createWebhookSecret = () => randomBytes(32).toString('base64url')
