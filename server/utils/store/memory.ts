import type { ActionRecord, LiveReading } from '../sim/engine'
import { demoUsers } from './demo-users'
import type { PushSubscriptionRecord, Store, UserRecord } from './types'

/** DB가 없을 때(로컬 개발, 테스트, 미리보기 배포) 쓰는 메모리 저장소. 서버를 다시 켜면 비워집니다. */
export function createMemoryStore(): Store {
  const users: UserRecord[] = demoUsers()
  const actions: Array<ActionRecord & { userId: string }> = []
  const subscriptions = new Map<string, PushSubscriptionRecord>()
  const notified = new Set<string>()
  const readings: LiveReading[] = []

  return {
    kind: 'memory',
    async listActionsSince(since) {
      return actions.filter((action) => action.sentAt >= since).map(({ userId: _userId, ...action }) => action)
    },
    async insertAction(record) {
      if (actions.some((action) => action.issueId === record.issueId)) return false
      actions.push(record)
      return true
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
      const cutoff = Date.now() - 120_000
      for (let i = readings.length - 1; i >= 0; i -= 1) if (readings[i]!.at < cutoff) readings.splice(i, 1)
    },
    async listReadingsSince(since) {
      return readings.filter((reading) => reading.at >= since)
    },
  }
}
