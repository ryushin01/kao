import type { UserRole } from '../../../src/shared/api/contract'
import type { ActionRecord, LiveReading } from '../sim/engine'

export interface UserRecord {
  id: string
  login: string
  name: string
  role: UserRole
  vehicleIds: string[]
  passwordHash: string
}

export interface PushSubscriptionRecord {
  endpoint: string
  p256dh: string
  auth: string
  userId: string
}

export interface Store {
  readonly kind: 'memory' | 'postgres'
  listActionsSince(since: number): Promise<ActionRecord[]>
  /** 같은 문제에 이미 조치가 있으면 false */
  insertAction(record: ActionRecord & { userId: string }): Promise<boolean>
  findUserByLogin(login: string): Promise<UserRecord | null>
  findUserById(id: string): Promise<UserRecord | null>
  savePushSubscription(record: PushSubscriptionRecord): Promise<void>
  deletePushSubscription(endpoint: string, userId: string): Promise<void>
  listPushSubscriptions(): Promise<Array<PushSubscriptionRecord & { role: UserRole; vehicleIds: string[] }>>
  /** 이 문제를 이 구독에 보낼 차례면 true(처음 한 번만) */
  claimDelivery(issueId: string, endpoint: string): Promise<boolean>
  /** 보내지 못했으면 다음 검사 때 다시 보내도록 기록을 지웁니다. */
  releaseDelivery(issueId: string, endpoint: string): Promise<void>
  insertReading(reading: LiveReading): Promise<void>
  listReadingsSince(since: number): Promise<LiveReading[]>
}
