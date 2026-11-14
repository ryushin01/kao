import { neon } from '@neondatabase/serverless'
import type { ActionCode, Severity, UserRole } from '../../../src/shared/api/contract'
import { ACK_TIMEOUT } from '../sim/live'
import type { ActionRecord, AckResult, LiveIssueRecord, LiveReading } from '../sim/types'
import type { Store, UserRecord } from './types'

interface UserRow {
  id: string
  login: string
  name: string
  role: UserRole
  vehicle_ids: string[]
  password_hash: string
}

interface ActionRow {
  id: string
  issue_id: string
  vehicle_id: string
  action: ActionCode
  sent_at: string
  delivered_at: string | null
  acked_at: string | null
  ack_result: AckResult | null
  ack_message: string | null
}

interface ReadingRow {
  vehicle_id: string
  at: string
  speed: number | null
  metrics: Record<string, number>
  lat: number | null
  lng: number | null
  route_progress: number | null
  odometer: number | null
}

interface LiveIssueRow {
  id: string
  vehicle_id: string
  metric_key: string
  severity: Severity
  detected_at: string
  cleared_at: string | null
  resolved_at: string | null
  checked_at: string
}

const toUser = (row: UserRow): UserRecord => ({
  id: row.id,
  login: row.login,
  name: row.name,
  role: row.role,
  vehicleIds: row.vehicle_ids,
  passwordHash: row.password_hash,
})

// bigint 열은 문자열로 옵니다.
const toNumber = (value: string | null) => (value === null ? null : Number(value))

const toAction = (row: ActionRow): ActionRecord => ({
  id: row.id,
  issueId: row.issue_id,
  vehicleId: row.vehicle_id,
  action: row.action,
  sentAt: Number(row.sent_at),
  deliveredAt: toNumber(row.delivered_at),
  ack: row.ack_result ? { at: Number(row.acked_at), result: row.ack_result, message: row.ack_message } : null,
})

const toReading = (row: ReadingRow): LiveReading => ({
  vehicleId: row.vehicle_id,
  at: Number(row.at),
  speed: row.speed ?? undefined,
  metrics: row.metrics,
  position:
    row.lat !== null && row.lng !== null
      ? { lat: row.lat, lng: row.lng, progress: row.route_progress, odometer: row.odometer ?? 0 }
      : undefined,
})

const toLiveIssue = (row: LiveIssueRow): LiveIssueRecord => ({
  id: row.id,
  vehicleId: row.vehicle_id,
  metricKey: row.metric_key,
  severity: row.severity,
  detectedAt: Number(row.detected_at),
  clearedAt: toNumber(row.cleared_at),
  resolvedAt: toNumber(row.resolved_at),
  checkedAt: Number(row.checked_at),
})

/** Neon(Postgres) 저장소. 서버리스 함수에서 HTTP로 질의합니다. */
export function createPostgresStore(url: string): Store {
  const sql = neon(url)
  return {
    kind: 'postgres',
    async listActionsSince(since) {
      const rows = (await sql`
        select id, issue_id, vehicle_id, action, sent_at, delivered_at, acked_at, ack_result, ack_message
        from remote_actions where sent_at >= ${since} order by sent_at
      `) as ActionRow[]
      return rows.map(toAction)
    },
    async insertAction(record) {
      // 응답을 기다리는 조치가 이미 있으면(remote_actions_pending_issue) 넣지 않습니다.
      const rows = await sql`
        insert into remote_actions (id, issue_id, vehicle_id, action, sent_at, user_id)
        values (${record.id}, ${record.issueId}, ${record.vehicleId}, ${record.action}, ${record.sentAt}, ${record.userId})
        on conflict do nothing
        returning id
      `
      return rows.length > 0
    },
    async expireCommands(issueId, now) {
      await sql`
        update remote_actions set ack_result = 'timeout', acked_at = sent_at + ${ACK_TIMEOUT}
        where issue_id = ${issueId} and issue_id like 'live-%' and ack_result is null and sent_at <= ${now - ACK_TIMEOUT}
      `
    },
    async takeCommands(vehicleId, now) {
      const rows = (await sql`
        update remote_actions set delivered_at = coalesce(delivered_at, ${now})
        where vehicle_id = ${vehicleId} and issue_id like 'live-%' and ack_result is null and sent_at > ${now - ACK_TIMEOUT}
        returning id, issue_id, vehicle_id, action, sent_at, delivered_at, acked_at, ack_result, ack_message
      `) as ActionRow[]
      return rows.map(toAction).sort((a, b) => a.sentAt - b.sentAt)
    },
    async ackCommand({ id, vehicleId, ack, now }) {
      const rows = await sql`
        update remote_actions set acked_at = ${ack.at}, ack_result = ${ack.result}, ack_message = ${ack.message}
        where id = ${id} and vehicle_id = ${vehicleId} and issue_id like 'live-%' and ack_result is null and sent_at > ${now - ACK_TIMEOUT}
        returning id
      `
      if (rows.length > 0) return 'ok'
      const existing = await sql`select id from remote_actions where id = ${id} and vehicle_id = ${vehicleId} and issue_id like 'live-%'`
      return existing.length > 0 ? 'closed' : 'missing'
    },
    async findUserByLogin(login) {
      const rows = (await sql`select * from users where login = ${login}`) as UserRow[]
      return rows[0] ? toUser(rows[0]) : null
    },
    async findUserById(id) {
      const rows = (await sql`select * from users where id = ${id}`) as UserRow[]
      return rows[0] ? toUser(rows[0]) : null
    },
    async savePushSubscription(record) {
      await sql`
        insert into push_subscriptions (endpoint, p256dh, auth, user_id)
        values (${record.endpoint}, ${record.p256dh}, ${record.auth}, ${record.userId})
        on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, user_id = excluded.user_id
      `
    },
    async deletePushSubscription(endpoint, userId) {
      await sql`delete from push_subscriptions where endpoint = ${endpoint} and user_id = ${userId}`
    },
    async listPushSubscriptions() {
      const rows = (await sql`
        select s.endpoint, s.p256dh, s.auth, s.user_id, u.role, u.vehicle_ids
        from push_subscriptions s join users u on u.id = s.user_id
      `) as Array<{ endpoint: string; p256dh: string; auth: string; user_id: string; role: UserRole; vehicle_ids: string[] }>
      return rows.map((row) => ({ endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth, userId: row.user_id, role: row.role, vehicleIds: row.vehicle_ids }))
    },
    async claimDelivery(issueId, endpoint) {
      const rows = await sql`
        insert into push_deliveries (issue_id, endpoint) values (${issueId}, ${endpoint}) on conflict do nothing returning issue_id
      `
      return rows.length > 0
    },
    async releaseDelivery(issueId, endpoint) {
      await sql`delete from push_deliveries where issue_id = ${issueId} and endpoint = ${endpoint}`
    },
    async insertReading(reading) {
      const position = reading.position
      await sql`
        insert into telemetry_readings (vehicle_id, at, speed, metrics, lat, lng, route_progress, odometer)
        values (
          ${reading.vehicleId}, ${reading.at}, ${reading.speed ?? null}, ${JSON.stringify(reading.metrics)},
          ${position?.lat ?? null}, ${position?.lng ?? null}, ${position?.progress ?? null}, ${position?.odometer ?? null}
        )
      `
    },
    async listReadingsSince(since) {
      const rows = (await sql`
        select vehicle_id, at, speed, metrics, lat, lng, route_progress, odometer
        from telemetry_readings where at >= ${since} order by at
      `) as ReadingRow[]
      return rows.map(toReading)
    },
    async listVehicleReadings(vehicleId, from, to) {
      const rows = (await sql`
        select vehicle_id, at, speed, metrics, lat, lng, route_progress, odometer
        from telemetry_readings where vehicle_id = ${vehicleId} and at >= ${from} and at <= ${to} order by at
      `) as ReadingRow[]
      return rows.map(toReading)
    },
    async latestReadingAt(vehicleId) {
      const rows = (await sql`select max(at) as at from telemetry_readings where vehicle_id = ${vehicleId}`) as Array<{ at: string | null }>
      return toNumber(rows[0]?.at ?? null)
    },
    async lastPositionedReading(vehicleId, since) {
      const rows = (await sql`
        select vehicle_id, at, speed, metrics, lat, lng, route_progress, odometer
        from telemetry_readings where vehicle_id = ${vehicleId} and at >= ${since} and lat is not null order by at desc limit 1
      `) as ReadingRow[]
      return rows[0] ? toReading(rows[0]) : null
    },
    async deleteReadingsBefore(before) {
      await sql`delete from telemetry_readings where at < ${before}`
    },
    async listLiveIssues(since) {
      const rows = (await sql`
        select id, vehicle_id, metric_key, severity, detected_at, cleared_at, resolved_at, checked_at
        from live_issues where resolved_at is null or resolved_at >= ${since}
      `) as LiveIssueRow[]
      return rows.map(toLiveIssue)
    },
    async listOpenLiveIssues(vehicleId) {
      const rows = (await sql`
        select id, vehicle_id, metric_key, severity, detected_at, cleared_at, resolved_at, checked_at
        from live_issues where vehicle_id = ${vehicleId} and resolved_at is null
      `) as LiveIssueRow[]
      return rows.map(toLiveIssue)
    },
    async liveIssueWatermarks(vehicleId) {
      const rows = (await sql`
        select metric_key, max(checked_at) as checked_at from live_issues where vehicle_id = ${vehicleId} group by metric_key
      `) as Array<{ metric_key: string; checked_at: string }>
      return Object.fromEntries(rows.map((row) => [row.metric_key, Number(row.checked_at)]))
    },
    async insertLiveIssue(record) {
      const rows = await sql`
        insert into live_issues (id, vehicle_id, metric_key, severity, detected_at, cleared_at, resolved_at, checked_at)
        values (
          ${record.id}, ${record.vehicleId}, ${record.metricKey}, ${record.severity}, ${record.detectedAt},
          ${record.clearedAt}, ${record.resolvedAt}, ${record.checkedAt}
        )
        on conflict do nothing
        returning id
      `
      return rows.length > 0
    },
    async updateLiveIssue(record, expectedCheckedAt) {
      const rows = await sql`
        update live_issues
        set severity = ${record.severity}, cleared_at = ${record.clearedAt}, resolved_at = ${record.resolvedAt}, checked_at = ${record.checkedAt}
        where id = ${record.id} and resolved_at is null and checked_at = ${expectedCheckedAt}
        returning id
      `
      return rows.length > 0
    },
  }
}
