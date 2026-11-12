import { createHmac, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import { createError, deleteCookie, getCookie, getRequestHeader, getRequestURL, setCookie } from 'h3'
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

const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url')

export function encodeSession(userId: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: now + MAX_AGE * 1000 })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function decodeSession(value: string | undefined, now = Date.now()): string | null {
  if (!value) return null
  const [payload, signature] = value.split('.')
  if (!payload || !signature) return null
  const expected = Buffer.from(sign(payload))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { uid: string; exp: number }
    return exp > now ? uid : null
  } catch {
    return null
  }
}

export function startSession(event: H3Event, userId: string) {
  setCookie(event, COOKIE, encodeSession(userId), {
    httpOnly: true,
    secure: getRequestURL(event).protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
  })
}

export function endSession(event: H3Event) {
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
  const userId = decodeSession(getCookie(event, COOKIE))
  if (!userId) return null
  const user = await useStore().findUserById(userId)
  return user ? toSessionUser(user) : null
}

export async function requireUser(event: H3Event, role?: UserRole): Promise<SessionUser> {
  const user = await readSessionUser(event)
  if (!user) throw createError({ statusCode: 401, message: '로그인이 필요합니다.' })
  if (role && user.role !== role) throw createError({ statusCode: 403, message: '이 기능을 쓸 권한이 없습니다.' })
  return user
}

/** 쿠키를 쓰는 변경 요청은 같은 출처에서 온 것만 받습니다(SameSite=Lax에 더한 CSRF 방어). */
export function assertSameOrigin(event: H3Event) {
  const origin = getRequestHeader(event, 'origin')
  if (origin && new URL(origin).host !== getRequestURL(event).host) {
    throw createError({ statusCode: 403, message: '다른 사이트에서 온 요청은 받지 않습니다.' })
  }
}
