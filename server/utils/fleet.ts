import { randomUUID } from 'node:crypto'
import type { ActionCode, RemoteActionResponse, SessionUser } from '../../src/shared/api/contract'
import { checkAction, computeFrame, dayStartOf } from './sim/engine'
import type { ActionRecord, LiveReading } from './sim/engine'
import { useStore } from './store'

const CACHE_MS = 1500
let actionCache: { fetchedAt: number; dayStart: number; actions: ActionRecord[] } | null = null
let readingCache: { fetchedAt: number; readings: LiveReading[] } | null = null

/**
 * 오늘(KST) 보낸 원격 조치. 0.5초마다 프레임을 만들 때마다 DB를 읽지 않도록 1.5초 동안 기억합니다.
 * 다른 인스턴스에서 보낸 조치도 길어야 1.5초 뒤에 반영됩니다.
 */
export async function todaysActions(now: number, fresh = false) {
  const dayStart = dayStartOf(now)
  if (!fresh && actionCache && actionCache.dayStart === dayStart && now - actionCache.fetchedAt < CACHE_MS) {
    return actionCache.actions
  }
  const actions = await useStore().listActionsSince(dayStart)
  actionCache = { fetchedAt: now, dayStart, actions }
  return actions
}

/** 최근 1분 안에 실제 차량에서 들어온 측정값 */
export async function recentReadings(now: number) {
  if (readingCache && now - readingCache.fetchedAt < CACHE_MS) return readingCache.readings
  const readings = await useStore().listReadingsSince(now - 60_000)
  readingCache = { fetchedAt: now, readings }
  return readings
}

export async function frameFor(user: SessionUser, now = Date.now()) {
  const [actions, readings] = await Promise.all([todaysActions(now), recentReadings(now)])
  return computeFrame({ now, actions, readings, vehicleIds: user.vehicleIds })
}

export class RemoteActionError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message)
  }
}

export async function sendRemoteAction(user: SessionUser, vehicleId: string, issueId: string, action: ActionCode): Promise<RemoteActionResponse> {
  const now = Date.now()
  const actions = await todaysActions(now, true)
  const check = checkAction(now, actions, vehicleId, issueId, action)
  if (!check.ok) throw new RemoteActionError(check.message, check.statusCode)

  const record: ActionRecord = { id: randomUUID(), issueId, vehicleId, action, sentAt: now }
  const inserted = await useStore().insertAction({ ...record, userId: user.id })
  if (!inserted) throw new RemoteActionError('다른 관제 요원이 먼저 조치했습니다. 목록을 새로 확인해 주세요.', 409)

  const next = [...actions, record]
  actionCache = { fetchedAt: now, dayStart: dayStartOf(now), actions: next }
  const frame = computeFrame({ now, actions: next, vehicleIds: [vehicleId] })
  return { entry: frame.log.find((entry) => entry.id === `${record.id}-sent`)!, vehicle: frame.vehicles[0]! }
}
