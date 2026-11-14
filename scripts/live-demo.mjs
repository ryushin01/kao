/**
 * 실차 장치 흉내(데모). 실제 차량 대신 측정값과 GPS를 보내고, 응답에 든 원격 조치 명령을 잠시 뒤 적용했다고 알립니다.
 * 관제 화면에서 실측 문제가 열리고 → 조치를 보내면 → 차량이 받아 적용하고 → 지표가 돌아와 해결되는 흐름을 볼 수 있습니다.
 *
 *   INGEST_TOKEN=local-token pnpm dev                       # 다른 터미널에서 로컬 서버
 *   INGEST_TOKEN=local-token pnpm live:demo --vehicle kao-0001 --fault coolant
 *   node --env-file=.env.ingest.local scripts/live-demo.mjs --url https://kao-ryushin01.vercel.app --vehicle kao-0003 --fault tire-r
 *
 * 옵션
 *   --url        서버 주소(기본 http://localhost:3000)
 *   --token      수신 토큰(기본 INGEST_TOKEN 환경 변수)
 *   --vehicle    탈것 id(기본 kao-0001)
 *   --fault      기준을 넘어가게 할 지표 key(생략하면 정상 주행만)
 *   --seconds    보낼 시간(기본 180초)
 *   --interval   보내는 간격(기본 1000ms)
 *   --ack        명령에 할 응답: applied, failed, none(응답 안 함). 기본 applied
 *   --ack-delay  명령을 받은 뒤 응답까지(기본 2000ms)
 *   --detour     시작 10초 뒤부터 이 시간(초) 동안 경로에서 옆으로 400m 벗어나 달림(경로 밖 GPS와 궤적 시험, 기본 0)
 *
 * Node 22.18 이상은 타입만 쓰는 TS 파일을 그대로 불러올 수 있어, 앱과 같은 탈것 정의·경로·좌표 변환을 씁니다.
 */
import { parseArgs } from 'node:util'
import { VEHICLE_SPECS } from '../server/utils/fleet-specs.ts'
import { metricState } from '../server/utils/sim/live.ts'
import { HEALTH_LABELS } from '../src/shared/api/contract.ts'
import { findRoute } from '../src/shared/config/routes.ts'
import { createRouteGeo, fromLocal, turnRateAt } from '../src/shared/lib/route-geo.ts'

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000' },
    token: { type: 'string', default: process.env.INGEST_TOKEN ?? '' },
    vehicle: { type: 'string', default: 'kao-0001' },
    fault: { type: 'string' },
    seconds: { type: 'string', default: '180' },
    interval: { type: 'string', default: '1000' },
    ack: { type: 'string', default: 'applied' },
    'ack-delay': { type: 'string', default: '2000' },
    detour: { type: 'string', default: '0' },
  },
})

const fail = (message) => {
  console.error(`[live-demo] ${message}`)
  process.exit(1)
}

const vehicle = VEHICLE_SPECS.find((item) => item.id === args.vehicle)
if (!vehicle) fail(`등록되지 않은 탈것입니다: ${args.vehicle}. ${VEHICLE_SPECS.map((item) => item.id).join(', ')} 가운데 고르세요.`)
if (!args.token) fail('수신 토큰이 없습니다. --token 또는 INGEST_TOKEN 환경 변수로 넘겨 주세요.')
if (!['applied', 'failed', 'none'].includes(args.ack)) fail('--ack는 applied, failed, none 가운데 하나입니다.')
const faulty = args.fault ? vehicle.metrics.find((metric) => metric.key === args.fault && metric.fault) : null
if (args.fault && !faulty) {
  const keys = vehicle.metrics.filter((metric) => metric.fault).map((metric) => metric.key)
  fail(`${vehicle.model}에서 문제로 만들 수 있는 지표는 ${keys.join(', ')}입니다.`)
}

const base = args.url.replace(/\/$/, '')
// 토큰이 평문으로 새지 않도록, 이 컴퓨터(loopback)가 아닌 주소는 https만 받습니다.
let target
try {
  target = new URL(base)
} catch {
  fail(`--url이 올바른 주소가 아닙니다: ${args.url}`)
}
if (target.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
  fail('--url은 https:// 주소여야 합니다(http://는 localhost에서만).')
}
const headers = { Authorization: `Bearer ${args.token}`, 'content-type': 'application/json' }
const route = findRoute(vehicle.routeId)
const geo = createRouteGeo(route)
const intervalMs = Number(args.interval)
const endAt = Date.now() + Number(args.seconds) * 1000
const [low, high] = vehicle.cruise

let progress = Math.random()
let elapsed = 0
/** 문제로 생긴 치우침. 문제가 커질 때는 fault.rate로 늘고, 조치를 적용하면 시뮬레이션처럼 초당 35%씩 줄어듭니다. */
let offset = 0
let recovering = false
let speedCap = null
/** 응답했거나 응답 중인 명령. 일시적으로 보내지 못하면 빼서, 다음 측정값 응답에 다시 오면 또 응답합니다. */
const handled = new Set()

const noise = (amount) => (Math.random() - 0.5) * 2 * amount

async function post(path, body) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(`${path} ${response.status}: ${data.message ?? data.statusMessage ?? ''}`)
    error.status = response.status
    throw error
  }
  return data
}

function acknowledge(command) {
  if (args.ack === 'none') {
    console.log(`  ↳ 명령 ${command.label}: 응답하지 않습니다(--ack none). 2분 뒤 관제 화면에 '차량 응답 없음'이 뜹니다.`)
    return
  }
  setTimeout(async () => {
    const result = args.ack
    try {
      await post(`/api/ingest/commands/${command.id}/ack`, {
        vehicleId: vehicle.id,
        result,
        message: result === 'failed' ? '데모 장치가 실패로 응답했습니다.' : undefined,
      })
      console.log(`  ↳ 명령 ${command.label}: ${result === 'applied' ? '적용으로' : '실패로'} 응답했습니다.`)
      if (result === 'applied') {
        recovering = true
        // 속도·출력 제한은 명령에 담긴 최고 속도를 따릅니다(관제 화면과 같은 값).
        if (command.parameters?.maxSpeedKmh) speedCap = command.parameters.maxSpeedKmh
      }
    } catch (error) {
      // 이미 응답했거나 시간이 지난 명령(409), 없는 명령(404)이 아니면 다음에 다시 응답합니다.
      const retry = error.status !== 404 && error.status !== 409
      if (retry) handled.delete(command.id)
      console.error(`  ↳ 명령 응답 실패${retry ? '(다음 측정값 때 다시 시도)' : ''}: ${error.message}`)
    }
  }, Number(args['ack-delay']))
}

const detourSeconds = Number(args.detour) || 0
/** 경로 옆으로 벗어난 거리(m) */
function detourOffset(t) {
  const start = 10
  const end = start + detourSeconds
  if (!detourSeconds || t < start || t > end) return 0
  return 400 * Math.min(1, (t - start) / 20, (end - t) / 20)
}

async function tick() {
  const dt = intervalMs / 1000
  elapsed += dt
  const raw = (low + high) / 2 + ((high - low) / 2) * Math.sin(elapsed / 25)
  const speed = Math.max(0, Math.min(raw, speedCap ?? Infinity) + noise(1.5))
  progress = (progress + (speed / 3600) * dt / route.lengthKm) % 1

  if (faulty) {
    const goal = faulty.fault.target - faulty.nominal
    offset = recovering ? offset * Math.exp(-0.35 * dt) : Math.sign(goal) * Math.min(Math.abs(offset) + faulty.fault.rate * dt, Math.abs(goal))
  }
  const metrics = {}
  for (const metric of vehicle.metrics) {
    if (metric.key === 'speed') continue
    const value = metric.derive ? metric.derive({ speed, progress, elapsed, curvature: Math.abs(turnRateAt(geo, progress)) }) : metric.nominal
    const shifted = value + (metric === faulty ? offset : 0) + noise(metric.noise)
    metrics[metric.key] = Number(Math.min(metric.max, Math.max(metric.min, shifted)).toFixed(metric.precision))
  }
  // GPS는 몇 m씩 흔들립니다. --detour면 그동안 경로 옆으로 400m까지(20초에 걸쳐) 벗어났다 돌아옵니다.
  const here = geo.pointAt(progress)
  const heading = geo.directionAt(progress)
  const aside = detourOffset(elapsed)
  const point = fromLocal(here.x - heading.z * aside, here.z + heading.x * aside)
  const gps = { lat: point.lat + noise(0.00003), lng: point.lng + noise(0.00003) }

  const result = await post('/api/ingest/telemetry', { vehicleId: vehicle.id, at: Date.now(), speed: Number(speed.toFixed(1)), metrics, ...gps })
  const watched = faulty ? ` · ${faulty.label} ${metrics[faulty.key]}${faulty.unit}(${HEALTH_LABELS[metricState(faulty, metrics[faulty.key])]})` : ''
  const where = result.position ? ` · ${result.position.onRoute ? `${result.position.lap}바퀴째 ${(result.position.progress * 100).toFixed(1)}%` : '경로 밖'}` : ''
  console.log(`${new Date().toLocaleTimeString('ko-KR')} ${speed.toFixed(0)}km/h${watched}${where}`)
  for (const command of result.commands ?? []) {
    if (handled.has(command.id)) continue
    handled.add(command.id)
    console.log(`  ↳ 명령을 받았습니다: ${command.label}(${command.action})`)
    acknowledge(command)
  }
}

console.log(`[live-demo] ${vehicle.maker} ${vehicle.model} → ${base} (${route.name}, ${args.seconds}초${faulty ? `, ${faulty.label} 문제` : ''})`)
let stopped = false
process.on('SIGINT', () => {
  stopped = true
})
while (!stopped && Date.now() < endAt) {
  const startedAt = Date.now()
  try {
    await tick()
  } catch (error) {
    console.error(`[live-demo] ${error.message}`)
  }
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, intervalMs - (Date.now() - startedAt))))
}
console.log('[live-demo] 끝. 30초 뒤 관제 화면은 이 탈것을 다시 시뮬레이션으로 보여 줍니다.')
