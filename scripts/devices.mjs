/**
 * 실차 장치(수신 토큰)를 관리합니다. 운영 DB(DATABASE_URL)에 씁니다.
 *
 *   node --env-file=.env.local scripts/devices.mjs add --vehicle kao-0001 --name "G80 OBD 단말"
 *   node --env-file=.env.local scripts/devices.mjs add --vehicle kao-0002 --webhook https://maker.example/kao/commands
 *   node --env-file=.env.local scripts/devices.mjs list
 *   node --env-file=.env.local scripts/devices.mjs revoke <장치 id>
 *
 * 토큰(과 웹훅 서명 비밀)은 만들 때 한 번만 보여 주고, DB에는 토큰의 SHA-256만 남깁니다. 잃어버리면 폐기하고 새로 만드세요.
 * 장치 토큰은 탈것 하나에만 쓸 수 있습니다. --webhook을 주면 그 탈것의 원격 조치 명령을 그 주소(https)로 보냅니다.
 */
import { randomBytes } from 'node:crypto'
import { parseArgs } from 'node:util'
import { neon } from '@neondatabase/serverless'
import { createDeviceToken, createWebhookSecret, hashToken } from '../server/utils/device-token.ts'
import { VEHICLE_SPECS } from '../server/utils/fleet-specs.ts'

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    vehicle: { type: 'string' },
    name: { type: 'string' },
    webhook: { type: 'string' },
  },
})

const fail = (message) => {
  console.error(`[device] ${message}`)
  process.exit(1)
}

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL
if (!url) fail('DATABASE_URL이 없습니다. 운영 DB 주소를 담은 env 파일과 함께 실행해 주세요(--env-file).')
const sql = neon(url)
const [command, id] = positionals
const time = (ms) => (ms ? new Date(Number(ms)).toISOString() : '-')

if (command === 'add') {
  const vehicle = VEHICLE_SPECS.find((item) => item.id === args.vehicle)
  if (!vehicle) fail(`--vehicle에 탈것 id를 주세요: ${VEHICLE_SPECS.map((item) => item.id).join(', ')}`)
  if (args.webhook) {
    let target
    try {
      target = new URL(args.webhook)
    } catch {
      fail(`--webhook이 올바른 주소가 아닙니다: ${args.webhook}`)
    }
    if (target.protocol !== 'https:') fail('--webhook은 https:// 주소여야 합니다.')
  }
  const device = {
    id: `dev_${randomBytes(6).toString('hex')}`,
    token: createDeviceToken(),
    secret: args.webhook ? createWebhookSecret() : null,
  }
  const name = args.name ?? `${vehicle.maker} ${vehicle.model} 장치`
  await sql`
    insert into devices (id, vehicle_id, name, token_hash, created_at, webhook_url, webhook_secret)
    values (${device.id}, ${vehicle.id}, ${name}, ${hashToken(device.token)}, ${Date.now()}, ${args.webhook ?? null}, ${device.secret})
  `
  console.log(`[device] ${device.id} (${vehicle.id}, ${name})를 만들었습니다. 아래 값은 다시 볼 수 없으니 장치에 바로 넣어 두세요.`)
  console.log(`  수신 토큰: ${device.token}`)
  if (device.secret) console.log(`  웹훅 서명 비밀: ${device.secret}  (${args.webhook}로 명령을 보냅니다)`)
} else if (command === 'list') {
  const rows = await sql`select id, vehicle_id, name, created_at, last_seen_at, revoked_at, webhook_url from devices order by created_at`
  if (!rows.length) console.log('[device] 등록된 장치가 없습니다.')
  for (const row of rows) {
    const state = row.revoked_at ? `폐기 ${time(row.revoked_at)}` : `마지막 요청 ${time(row.last_seen_at)}`
    console.log(`${row.id}  ${row.vehicle_id}  ${row.name}  만듦 ${time(row.created_at)}  ${state}${row.webhook_url ? `  웹훅 ${row.webhook_url}` : ''}`)
  }
} else if (command === 'revoke') {
  if (!id) fail('폐기할 장치 id를 주세요: scripts/devices.mjs revoke dev_…')
  const rows = await sql`update devices set revoked_at = ${Date.now()} where id = ${id} and revoked_at is null returning id`
  if (!rows.length) fail(`폐기할 장치가 없습니다(없는 id이거나 이미 폐기함): ${id}`)
  console.log(`[device] ${id}를 폐기했습니다. 이 토큰으로 보낸 요청은 이제 401입니다.`)
} else {
  fail('명령: add --vehicle <id> [--name <이름>] [--webhook <https 주소>] | list | revoke <장치 id>')
}
