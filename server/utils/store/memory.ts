import { ACK_TIMEOUT, isLiveIssueId, isPendingCommand } from '../sim/live'
import type { ActionRecord, LiveIssueRecord, LiveReading } from '../sim/types'
import { demoUsers } from './demo-users'
import type { PushSubscriptionRecord, Store, UserRecord } from './types'

/** 지표 이력(최근 60분)과 그 앞 30초를 볼 수 있을 만큼 측정값을 둡니다. */
const READING_KEEP_MS = 61 * 60_000

/** DB가 없을 때(로컬 개발, 테스트, 미리보기 배포) 쓰는 메모리 저장소. 서버를 다시 켜면 비워집니다. */
export function createMemoryStore(): Store {
  const users: UserRecord[] = demoUsers()
  const actions: Array<ActionRecord & { userId: string }> = []
  const subscriptions = new Map<string, PushSubscriptionRecord>()
  const notified = new Set<string>()
  const readings: LiveReading[] = []
  const liveIssues: LiveIssueRecord[] = []
  const copy = ({ userId: _userId, ...action }: ActionRecord & { userId: string }): ActionRecord => ({ ...action })

  return {
    kind: 'memory',
    async listActionsSince(since) {
      return actions.filter((action) => action.sentAt >= since).map(copy)
    },
    async insertAction(record) {
      if (actions.some((action) => action.issueId === record.issueId && !action.ack)) return false
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
    async findUserByLogin(login) {
      return users.find((user) => user.login === login) ?? null
    },
    async findUserById(id) {
      return users.find((user) => user.id === id) ?? null
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
      notified.add(key)
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
    async insertLiveIssue(record) {
      const taken = liveIssues.some(
        (issue) => issue.id === record.id || (issue.vehicleId === record.vehicleId && issue.metricKey === record.metricKey && issue.resolvedAt === null),
      )
      if (taken) return false
      liveIssues.push({ ...record })
      return true
    },
    async updateLiveIssue(record) {
      const issue = liveIssues.find((item) => item.id === record.id && item.resolvedAt === null)
      if (!issue) return
      issue.severity = record.severity
      issue.clearedAt = record.clearedAt
      issue.resolvedAt = record.resolvedAt
    },
  }
}
