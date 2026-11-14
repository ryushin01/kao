import { randomUUID } from 'node:crypto'
import type { ActionCode, RemoteActionResponse, SessionUser } from '../../src/shared/api/contract'
import { checkAction, computeFrame, dayStartOf } from './sim/engine'
import type { FrameInput } from './sim/engine'
import { isLiveIssueId } from './sim/live'
import type { ActionRecord, LiveIssueRecord, LiveReading } from './sim/types'
import { useStore } from './store'

const CACHE_MS = 1500
/** 해결한 문제를 화면에 남겨 두는 시간(엔진의 RESOLVED_VISIBLE_MS와 같음) */
const RESOLVED_VISIBLE_MS = 20 * 60_000

let actionCache: { fetchedAt: number; dayStart: number; actions: ActionRecord[] } | null = null
let readingCache: { fetchedAt: number; readings: LiveReading[] } | null = null
let liveIssueCache: { fetchedAt: number; since: number; issues: LiveIssueRecord[] } | null = null

/**
 * 오늘(KST) 보낸 원격 조치. 0.5초마다 프레임을 만들 때마다 DB를 읽지 않도록 1.5초 동안 기억합니다.
 * 다른 인스턴스에서 보낸 조치와 차량 응답도 길어야 1.5초 뒤에 반영됩니다.
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

/** 실측 문제: 해결되지 않은 것 전부와 오늘(또는 최근 20분 안에) 해결한 것 */
export async function recentLiveIssues(now: number, fresh = false) {
  const since = Math.min(dayStartOf(now), now - RESOLVED_VISIBLE_MS)
  if (!fresh && liveIssueCache && liveIssueCache.since === since && now - liveIssueCache.fetchedAt < CACHE_MS) {
    return liveIssueCache.issues
  }
  const issues = await useStore().listLiveIssues(since)
  liveIssueCache = { fetchedAt: now, since, issues }
  return issues
}

/** 프레임 계산에 필요한 기록을 한 번에 모읍니다. */
export async function frameInput(now: number, fresh = false): Promise<Omit<FrameInput, 'vehicleIds'>> {
  const [actions, readings, liveIssues] = await Promise.all([todaysActions(now, fresh), recentReadings(now), recentLiveIssues(now, fresh)])
  return { now, actions, readings, liveIssues }
}

export async function frameFor(user: SessionUser, now = Date.now()) {
  return computeFrame({ ...(await frameInput(now)), vehicleIds: user.vehicleIds })
}

export class RemoteActionError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message)
  }
}

/**
 * 원격 조치를 보냅니다. 시뮬레이션 문제는 기록하면 차량이 ACTION_LATENCY 뒤에 적용한 것으로 보고,
 * 실측 문제는 명령으로 쌓아 두었다가 차량이 받아 가 응답합니다(docs/integration.md).
 */
export async function sendRemoteAction(user: SessionUser, vehicleId: string, issueId: string, action: ActionCode): Promise<RemoteActionResponse> {
  const now = Date.now()
  const input = await frameInput(now, true)
  const check = checkAction(input, vehicleId, issueId, action)
  if (!check.ok) throw new RemoteActionError(check.message, check.statusCode)

  const store = useStore()
  // 응답 없이 시간이 지난 명령을 먼저 닫아야 같은 문제에 새 명령을 넣을 수 있습니다.
  if (isLiveIssueId(issueId)) await store.expireCommands(issueId, now)
  const record: ActionRecord = { id: randomUUID(), issueId, vehicleId, action, sentAt: now }
  const inserted = await store.insertAction({ ...record, userId: user.id })
  if (!inserted) throw new RemoteActionError('다른 관제 요원이 먼저 조치했습니다. 목록을 새로 확인해 주세요.', 409)

  const next = [...input.actions, record]
  actionCache = { fetchedAt: now, dayStart: dayStartOf(now), actions: next }
  const frame = computeFrame({ ...input, actions: next, vehicleIds: [vehicleId] })
  return { entry: frame.log.find((entry) => entry.id === `${record.id}-sent`)!, vehicle: frame.vehicles[0]! }
}

/** 수신 API가 기록을 바꾼 뒤, 같은 인스턴스의 관제 화면에 바로 보이도록 기억해 둔 값을 버립니다. */
export function invalidateLiveCaches() {
  actionCache = null
  readingCache = null
  liveIssueCache = null
}
