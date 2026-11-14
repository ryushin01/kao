import { neon } from '@neondatabase/serverless'
import type { ActionCode, UserRole } from '../../../src/shared/api/contract'
import type { Store, UserRecord } from './types'

interface UserRow {
  id: string
  login: string
  name: string
  role: UserRole
  vehicle_ids: string[]
  password_hash: string
}

const toUser = (row: UserRow): UserRecord => ({
  id: row.id,
  login: row.login,
  name: row.name,
  role: row.role,
  vehicleIds: row.vehicle_ids,
  passwordHash: row.password_hash,
})

/** Neon(Postgres) 저장소. 서버리스 함수에서 HTTP로 질의합니다. */
export function createPostgresStore(url: string): Store {
  const sql = neon(url)
  return {
    kind: 'postgres',
    async listActionsSince(since) {
      const rows = (await sql`
        select id, issue_id, vehicle_id, action, sent_at from remote_actions where sent_at >= ${since} order by sent_at
      `) as Array<{ id: string; issue_id: string; vehicle_id: string; action: ActionCode; sent_at: string }>
      return rows.map((row) => ({ id: row.id, issueId: row.issue_id, vehicleId: row.vehicle_id, action: row.action, sentAt: Number(row.sent_at) }))
    },
    async insertAction(record) {
      const rows = await sql`
        insert into remote_actions (id, issue_id, vehicle_id, action, sent_at, user_id)
        values (${record.id}, ${record.issueId}, ${record.vehicleId}, ${record.action}, ${record.sentAt}, ${record.userId})
        on conflict (issue_id) do nothing
        returning id
      `
      return rows.length > 0
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
      await sql`
        insert into telemetry_readings (vehicle_id, at, speed, metrics)
        values (${reading.vehicleId}, ${reading.at}, ${reading.speed ?? null}, ${JSON.stringify(reading.metrics)})
      `
    },
    async listReadingsSince(since) {
      const rows = (await sql`
        select vehicle_id, at, speed, metrics from telemetry_readings where at >= ${since} order by at
      `) as Array<{ vehicle_id: string; at: string; speed: number | null; metrics: Record<string, number> }>
      return rows.map((row) => ({ vehicleId: row.vehicle_id, at: Number(row.at), speed: row.speed ?? undefined, metrics: row.metrics }))
    },
  }
}
