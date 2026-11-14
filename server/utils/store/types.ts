import type { UserRole } from '../../../src/shared/api/contract'
import type { ActionRecord, CommandAck, LiveIssueRecord, LiveReading } from '../sim/types'

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

export type AckOutcome = 'ok' | 'missing' | 'closed'

export interface Store {
  readonly kind: 'memory' | 'postgres'
  /** since 뒤로 보낸 원격 조치(실차 명령은 차량 응답까지) */
  listActionsSince(since: number): Promise<ActionRecord[]>
  /**
   * 조치를 넣습니다. 같은 문제에 차량 응답을 기다리는 조치가 이미 있으면 넣지 않고 false를 돌려줍니다.
   * 시뮬레이션 조치는 응답이 없으므로 문제마다 하나뿐입니다(동시에 보내면 한쪽만 들어감).
   */
  insertAction(record: ActionRecord & { userId: string }): Promise<boolean>
  /** 이 문제에 보낸 실차 명령 가운데 응답 시간이 지난 것을 '응답 없음'(timeout)으로 닫습니다. */
  expireCommands(issueId: string, now: number): Promise<void>
  /** 차량이 아직 응답할 수 있는 실차 명령. 처음 받아 간 시각을 남깁니다. */
  takeCommands(vehicleId: string, now: number): Promise<ActionRecord[]>
  /** 차량 응답을 남깁니다. 명령이 없으면 missing, 이미 응답했거나 응답 시간이 지났으면 closed */
  ackCommand(input: { id: string; vehicleId: string; ack: CommandAck; now: number }): Promise<AckOutcome>
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
  /** 한 탈것의 측정값(from 이상 to 이하, 시각 순) */
  listVehicleReadings(vehicleId: string, from: number, to: number): Promise<LiveReading[]>
  /** 이 탈것의 가장 최근 측정 시각(없으면 null) */
  latestReadingAt(vehicleId: string): Promise<number | null>
  /** since 뒤로 GPS 위치가 있는 가장 최근 측정값 */
  lastPositionedReading(vehicleId: string, since: number): Promise<LiveReading | null>
  deleteReadingsBefore(before: number): Promise<void>
  /** 해결되지 않은 실측 문제 전부와 since 뒤에 해결한 것 */
  listLiveIssues(since: number): Promise<LiveIssueRecord[]>
  /** 한 탈것의 해결되지 않은 실측 문제 */
  listOpenLiveIssues(vehicleId: string): Promise<LiveIssueRecord[]>
  /** 한 탈것의 지표마다 실측 문제에 반영한 가장 새 측정 시각(해결한 문제 포함) */
  liveIssueWatermarks(vehicleId: string): Promise<Record<string, number>>
  /** 새 실측 문제. 같은 지표에 해결되지 않은 문제가 이미 있으면(다른 요청이 먼저 열었으면) 넣지 않습니다. */
  insertLiveIssue(record: LiveIssueRecord): Promise<boolean>
  /**
   * 해결되지 않은 실측 문제를 바꿉니다. 저장된 checkedAt이 expectedCheckedAt(판단에 쓴 값)과 같을 때만 바꾸고,
   * 그사이 다른 요청이 먼저 바꿨으면 false를 돌려줍니다(다시 읽어 판단).
   */
  updateLiveIssue(record: LiveIssueRecord, expectedCheckedAt: number): Promise<boolean>
}
