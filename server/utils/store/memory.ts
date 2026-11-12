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
    async claimNotification(issueId) {
      if (notified.has(issueId)) return false
      notified.add(issueId)
      return true
    },
    async insertReading(reading) {
      readings.push(reading)
      if (readings.length > 500) readings.splice(0, readings.length - 500)
    },
    async listReadingsSince(since) {
      return readings.filter((reading) => reading.at >= since)
    },
  }
}
