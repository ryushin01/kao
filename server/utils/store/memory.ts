import { RETENTION } from '../retention'
import { ACK_TIMEOUT, isLiveIssueId, isPendingCommand } from '../sim/live'
import type { ActionRecord, LiveIssueRecord, LiveReading } from '../sim/types'
import { demoUsers } from './demo-users'
import type { DeviceRecord, LoginAttempt, PushSubscriptionRecord, SessionRecord, Store, UserRecord } from './types'

/** 지표 이력(최근 60분)과 그 앞 30초를 볼 수 있을 만큼 측정값을 둡니다. */
const READING_KEEP_MS = 61 * 60_000

/**
 * DB가 없을 때(로컬 개발, 테스트, 미리보기 배포) 쓰는 메모리 저장소. 서버를 다시 켜면 비워집니다.
 * devices로 실차 장치를 미리 넣어 둘 수 있습니다(테스트용. 운영 장치는 pnpm device로 DB에 넣음).
 */
export function createMemoryStore(seed: DeviceRecord[] = []): Store {
  const devices = seed.map((device) => ({ ...device }))
  const users: UserRecord[] = demoUsers()
  const actions: Array<ActionRecord & { userId: string }> = []
  const subscriptions = new Map<string, PushSubscriptionRecord>()
  /** 보낸 알림(문제·구독) → 보낸 시각 */
  const notified = new Map<string, number>()
  const readings: LiveReading[] = []
  const liveIssues: LiveIssueRecord[] = []
  const sessions = new Map<string, SessionRecord>()
  /** 로그인 시도 카운터: 키 → 창 시작 시각과 수 */
  const loginAttempts = new Map<string, { windowStart: number; count: number }>()
  const copy = ({ userId: _userId, ...action }: ActionRecord & { userId: string }): ActionRecord => ({ ...action })

  return {
    kind: 'memory',
    async listActionsSince(since) {
      return actions.filter((action) => action.sentAt >= since).map(copy)
    },
    async insertAction(record) {
      if (actions.some((action) => action.issueId === record.issueId && !action.ack)) return false
      // 서버를 오래 켜 둬도 쌓이지 않게 보관 기간이 지난 조치는 새로 넣을 때 지웁니다.
      for (let i = actions.length - 1; i >= 0; i -= 1) if (actions[i]!.sentAt < record.sentAt - RETENTION.actions) actions.splice(i, 1)
      actions.push({ ...record })
      return true
    },
    async expireCommands(issueId, now) {
      for (const action of actions) {
        if (action.issueId === issueId && isLiveIssueId(issueId) && !action.ack && now - action.sentAt >= ACK_TIMEOUT) {
          action.ack = { at: action.sentAt + ACK_TIMEOUT, result: 'timeout', message: null }
        }
      }
    },
    async takeCommands(vehicleId, now) {
      const pending = actions.filter((action) => action.vehicleId === vehicleId && isPendingCommand(action, now))
      for (const action of pending) action.deliveredAt ??= now
      return pending.map(copy)
    },
    async ackCommand({ id, vehicleId, ack, now }) {
      const action = actions.find((item) => item.id === id && item.vehicleId === vehicleId && isLiveIssueId(item.issueId))
      if (!action) return 'missing'
      if (!isPendingCommand(action, now)) return 'closed'
      action.ack = ack
      return 'ok'
    },
    async markCommandDelivered(id, now) {
      const action = actions.find((item) => item.id === id)
      if (action) action.deliveredAt ??= now
    },
    async findDeviceByTokenHash(tokenHash) {
      const device = devices.find((item) => item.tokenHash === tokenHash && item.revokedAt === null)
      return device ? { ...device } : null
    },
    async listWebhookDevices(vehicleId) {
      return devices.filter((item) => item.vehicleId === vehicleId && item.revokedAt === null && item.webhookUrl).map((item) => ({ ...item }))
    },
    async touchDevice(id, now) {
      const device = devices.find((item) => item.id === id)
      if (device) device.lastSeenAt = now
    },
    async insertDevice(record) {
      devices.push({ ...record })
    },
    async revokeDevice(id, now) {
      const device = devices.find((item) => item.id === id && item.revokedAt === null)
      if (!device) return false
      device.revokedAt = now
      return true
    },
    async findUserByLogin(login) {
      return users.find((user) => user.login === login) ?? null
    },
    async findUserById(id) {
      return users.find((user) => user.id === id) ?? null
    },
    async createSession(record) {
      // 끝난 세션은 새로 만들 때 정리합니다(서버를 오래 켜 둬도 쌓이지 않게).
      for (const [id, session] of sessions) if (session.expiresAt <= record.createdAt) sessions.delete(id)
      sessions.set(record.id, { ...record })
    },
    async findSessionUser(id, now) {
      const session = sessions.get(id)
      if (!session || session.expiresAt <= now) return null
      return users.find((user) => user.id === session.userId) ?? null
    },
    async deleteSession(id) {
      sessions.delete(id)
    },
    async reserveLoginAttempt(keys, now, windowMs) {
      // 창이 하루 넘게 지난 카운터는 지웁니다(서버를 오래 켜 둬도 쌓이지 않게).
      for (const [key, entry] of loginAttempts) if (entry.windowStart <= now - 86_400_000) loginAttempts.delete(key)
      const attempts: Record<string, LoginAttempt> = {}
      for (const key of keys) {
        const entry = loginAttempts.get(key)
        const next = !entry || entry.windowStart <= now - windowMs ? { windowStart: now, count: 1 } : { ...entry, count: entry.count + 1 }
        loginAttempts.set(key, next)
        attempts[key] = { ...next }
      }
      return attempts
    },
    async releaseLoginAttempt(key, windowStart) {
      const entry = loginAttempts.get(key)
      if (entry && entry.windowStart === windowStart) entry.count = Math.max(0, entry.count - 1)
    },
    async resetLoginAttempts(key) {
      loginAttempts.delete(key)
    },
    async pruneRecords(now) {
      const keep = <T>(list: T[], fresh: (item: T) => boolean) => {
        for (let i = list.length - 1; i >= 0; i -= 1) if (!fresh(list[i]!)) list.splice(i, 1)
      }
      keep(readings, (reading) => reading.at >= now - RETENTION.readings)
      for (const [key, entry] of loginAttempts) if (entry.windowStart < now - RETENTION.loginAttempts) loginAttempts.delete(key)
      keep(actions, (action) => action.sentAt >= now - RETENTION.actions)
      keep(liveIssues, (issue) => issue.resolvedAt === null || issue.resolvedAt >= now - RETENTION.liveIssues)
      for (const [key, at] of notified) if (at < now - RETENTION.deliveries) notified.delete(key)
      for (const [id, session] of sessions) if (session.expiresAt <= now) sessions.delete(id)
    },
    async savePushSubscription(record) {
      subscriptions.set(record.endpoint, record)
    },
    async deletePushSubscription(endpoint, userId) {
      if (subscriptions.get(endpoint)?.userId === userId) subscriptions.delete(endpoint)
    },
    async listPushSubscriptions() {
      return [...subscriptions.values()].flatMap((record) => {
        const user = users.find((item) => item.id === record.userId)
        return user ? [{ ...record, role: user.role, vehicleIds: user.vehicleIds }] : []
      })
    },
    async claimDelivery(issueId, endpoint) {
      const key = `${issueId} ${endpoint}`
      if (notified.has(key)) return false
      const now = Date.now()
      for (const [item, at] of notified) if (at < now - RETENTION.deliveries) notified.delete(item)
      notified.set(key, now)
      return true
    },
    async releaseDelivery(issueId, endpoint) {
      notified.delete(`${issueId} ${endpoint}`)
    },
    async insertReading(reading) {
      readings.push(reading)
      // 개수가 아니라 시각으로 정리해, 다른 탈것이 많이 보내도 유효한 측정값이 지워지지 않게 합니다.
      const cutoff = Date.now() - READING_KEEP_MS
      for (let i = readings.length - 1; i >= 0; i -= 1) if (readings[i]!.at < cutoff) readings.splice(i, 1)
    },
    async listReadingsSince(since) {
      return readings.filter((reading) => reading.at >= since)
    },
    async listVehicleReadings(vehicleId, from, to) {
      return readings.filter((reading) => reading.vehicleId === vehicleId && reading.at >= from && reading.at <= to).sort((a, b) => a.at - b.at)
    },
    async latestReadingAt(vehicleId) {
      let latest: number | null = null
      for (const reading of readings) if (reading.vehicleId === vehicleId && (latest === null || reading.at > latest)) latest = reading.at
      return latest
    },
    async lastPositionedReading(vehicleId, since) {
      let latest: LiveReading | null = null
      for (const reading of readings) {
        if (reading.vehicleId === vehicleId && reading.position && reading.at >= since && (!latest || reading.at >= latest.at)) latest = reading
      }
      return latest
    },
    async deleteReadingsBefore(before) {
      for (let i = readings.length - 1; i >= 0; i -= 1) if (readings[i]!.at < before) readings.splice(i, 1)
    },
    async listLiveIssues(since) {
      return liveIssues.filter((issue) => issue.resolvedAt === null || issue.resolvedAt >= since).map((issue) => ({ ...issue }))
    },
    async listOpenLiveIssues(vehicleId) {
      return liveIssues.filter((issue) => issue.vehicleId === vehicleId && issue.resolvedAt === null).map((issue) => ({ ...issue }))
    },
    async liveIssueWatermarks(vehicleId) {
      const marks: Record<string, number> = {}
      for (const issue of liveIssues) {
        if (issue.vehicleId === vehicleId) marks[issue.metricKey] = Math.max(marks[issue.metricKey] ?? Number.NEGATIVE_INFINITY, issue.checkedAt)
      }
      return marks
    },
    async insertLiveIssue(record) {
      const taken = liveIssues.some(
        (issue) => issue.id === record.id || (issue.vehicleId === record.vehicleId && issue.metricKey === record.metricKey && issue.resolvedAt === null),
      )
      if (taken) return false
      liveIssues.push({ ...record })
      return true
    },
    async updateLiveIssue(record, expectedCheckedAt) {
      const issue = liveIssues.find((item) => item.id === record.id && item.resolvedAt === null && item.checkedAt === expectedCheckedAt)
      if (!issue) return false
      issue.severity = record.severity
      issue.clearedAt = record.clearedAt
      issue.resolvedAt = record.resolvedAt
      issue.checkedAt = record.checkedAt
      return true
    },
  }
}
