/**
 * 운영 DB(Neon)에 스키마를 적용하고 데모 계정을 맞춥니다. Vercel 빌드(`vercel-build`)에서 실행합니다.
 * DATABASE_URL이 없으면(로컬, 미리보기 배포) 아무것도 하지 않습니다. 여러 번 실행해도 안전합니다.
 * Node 22.18 이상은 타입만 쓰는 TS 파일을 그대로 불러올 수 있어 계정 목록과 해시 함수를 앱과 함께 씁니다.
 */
import { readFile } from 'node:fs/promises'
import { neon } from '@neondatabase/serverless'
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../src/shared/api/contract.ts'
import { hashPassword, verifyPassword } from '../server/utils/password.ts'

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
if (!url) {
  console.log('[migrate] DATABASE_URL이 없어 건너뜁니다.')
  process.exit(0)
}

const sql = neon(url)
const schema = await readFile(new URL('../server/db/schema.sql', import.meta.url), 'utf8')
const statements = schema
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map((statement) => statement.trim())
  .filter(Boolean)
for (const statement of statements) await sql.query(statement)

for (const account of DEMO_ACCOUNTS) {
  const [existing] = await sql`select password_hash from users where login = ${account.login}`
  const hash = existing && verifyPassword(DEMO_PASSWORD, existing.password_hash) ? existing.password_hash : hashPassword(DEMO_PASSWORD)
  await sql`
    insert into users (id, login, name, role, vehicle_ids, password_hash)
    values (${`user-${account.login}`}, ${account.login}, ${account.name}, ${account.role}, ${account.vehicleIds}, ${hash})
    on conflict (login) do update
      set name = excluded.name, role = excluded.role, vehicle_ids = excluded.vehicle_ids, password_hash = excluded.password_hash
  `
}

// 오래된 기록 정리: 측정값은 하루, 원격 조치는 7일, 알림 기록은 7일
const now = Date.now()
await sql`delete from telemetry_readings where at < ${now - 86_400_000}`
await sql`delete from remote_actions where sent_at < ${now - 7 * 86_400_000}`
await sql`delete from push_deliveries where sent_at < now() - interval '7 days'`
console.log(`[migrate] 스키마 ${statements.length}문, 데모 계정 ${DEMO_ACCOUNTS.length}개 적용`)
