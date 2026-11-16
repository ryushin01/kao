import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { createError, deleteCookie, getCookie, getRequestHeader, getRequestIP, getRequestURL, setCookie } from 'h3'
import type { SessionUser, UserRole } from '../../src/shared/api/contract'
import { VEHICLE_SPECS } from './fleet-specs'
import { useStore } from './store'
import type { UserRecord } from './store'

const COOKIE = 'kao_session'
const MAX_AGE = 7 * 24 * 3600

function secret() {
  const value = process.env.SESSION_SECRET
  if (value) return value
  if (process.env.VERCEL_ENV === 'production') throw new Error('SESSION_SECRET이 설정되지 않았습니다.')
  return 'kao-local-development-secret'
}

const sign = (value: string) => createHmac('sha256', secret()).update(value).digest('base64url')

/**
 * 로그인 세션
 * - 쿠키: <무작위 세션 토큰>.<서명>. 서명이 맞지 않으면 저장소를 묻지 않고 거절합니다.
 * - 저장소(sessions): 토큰의 SHA-256만 둡니다. 로그아웃하면 그 세션을 지우므로 쿠키가 새어도 서버에서 끊을 수 있습니다
 *   (0.15.0까지는 서명만 확인해 7일 동안 끊을 수 없었음). 데모 계정을 여러 사람이 함께 쓰므로 계정의 다른 세션은 그대로 둡니다.
 */
export const sessionId = (token: string) => createHash('sha256').update(token).digest('hex')

export const encodeSessionCookie = (token: string) => `${token}.${sign(token)}`

/** 쿠키에서 세션 토큰을 꺼냅니다. 형식이나 서명이 맞지 않으면 null */
export function decodeSessionCookie(value: string | undefined): string | null {
  if (!value) return null
  const dot = value.lastIndexOf('.')
  if (dot <= 0) return null
  const token = value.slice(0, dot)
  const expected = Buffer.from(sign(token))
  const actual = Buffer.from(value.slice(dot + 1))
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? token : null
}

export async function startSession(event: H3Event, userId: string, now = Date.now()) {
  const token = randomBytes(32).toString('base64url')
  await useStore().createSession({ id: sessionId(token), userId, createdAt: now, expiresAt: now + MAX_AGE * 1000 })
  setCookie(event, COOKIE, encodeSessionCookie(token), {
    httpOnly: true,
    secure: getRequestURL(event).protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  })
}

export async function endSession(event: H3Event) {
  const token = decodeSessionCookie(getCookie(event, COOKIE))
  if (token) await useStore().deleteSession(sessionId(token))
  deleteCookie(event, COOKIE, { path: '/' })
}

export function toSessionUser(user: UserRecord): SessionUser {
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    role: user.role,
    vehicleIds: user.role === 'operator' ? VEHICLE_SPECS.map((vehicle) => vehicle.id) : user.vehicleIds,
  }
}

export async function readSessionUser(event: H3Event): Promise<SessionUser | null> {
  const token = decodeSessionCookie(getCookie(event, COOKIE))
  if (!token) return null
  const user = await useStore().findSessionUser(sessionId(token), Date.now())
  return user ? toSessionUser(user) : null
}

export async function requireUser(event: H3Event, role?: UserRole): Promise<SessionUser> {
  const user = await readSessionUser(event)
  if (!user) throw createError({ statusCode: 401, message: '로그인이 필요합니다.' })
  if (role && user.role !== role) throw createError({ statusCode: 403, message: '이 기능을 쓸 권한이 없습니다.' })
  return user
}

/**
 * 쿠키를 쓰는 변경 요청은 같은 출처에서 온 것만 받습니다(SameSite=Lax에 더한 CSRF 방어).
 * 샌드박스 iframe 등이 보내는 `Origin: null`처럼 주소로 읽을 수 없는 출처도 막습니다.
 */
export function assertSameOrigin(event: H3Event) {
  const origin = getRequestHeader(event, 'origin')
  if (!origin) return
  let host: string | null
  try {
    host = new URL(origin).host
  } catch {
    host = null
  }
  if (host !== getRequestURL(event).host) {
    throw createError({ statusCode: 403, message: '다른 사이트에서 온 요청은 받지 않습니다.' })
  }
}

/**
 * 요청한 쪽의 주소(로그인 시도 제한에 씀). Vercel은 x-forwarded-for를 클라이언트 주소로 덮어써 믿을 수 있고,
 * 직접 띄운 서버에서는 누구나 그 헤더를 꾸밀 수 있어 연결 주소를 씁니다.
 */
export function clientAddress(event: H3Event) {
  return getRequestIP(event, { xForwardedFor: process.env.VERCEL === '1' }) ?? 'unknown'
}
