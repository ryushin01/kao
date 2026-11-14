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
 *
 * Node 22.18 이상은 타입만 쓰는 TS 파일을 그대로 불러올 수 있어, 앱과 같은 탈것 정의·경로·좌표 변환을 씁니다.
 */
import { parseArgs } from 'node:util'
import { VEHICLE_SPECS } from '../server/utils/fleet-specs.ts'
import { metricState } from '../server/utils/sim/live.ts'
import { HEALTH_LABELS } from '../src/shared/api/contract.ts'
import { findRoute } from '../src/shared/config/routes.ts'
import { createRouteGeo } from '../src/shared/lib/route-geo.ts'

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
const seen = new Set()

const noise = (amount) => (Math.random() - 0.5) * 2 * amount

async function post(path, body) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${path} ${response.status}: ${data.message ?? data.statusMessage ?? ''}`)
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
        if (command.parameters?.maxSpeedKmh) speedCap = command.parameters.maxSpeedKmh
        if (command.parameters?.powerRatio) speedCap = Math.round(high * command.parameters.powerRatio)
      }
    } catch (error) {
      console.error(`  ↳ 명령 응답 실패: ${error.message}`)
    }
  }, Number(args['ack-delay']))
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
    const value = metric.derive ? metric.derive({ speed, progress, elapsed }) : metric.nominal
    const shifted = value + (metric === faulty ? offset : 0) + noise(metric.noise)
    metrics[metric.key] = Number(Math.min(metric.max, Math.max(metric.min, shifted)).toFixed(metric.precision))
  }
  // GPS는 몇 m씩 흔들립니다.
  const point = geo.toLatLng(progress)
  const gps = { lat: point.lat + noise(0.00003), lng: point.lng + noise(0.00003) }

  const result = await post('/api/ingest/telemetry', { vehicleId: vehicle.id, at: Date.now(), speed: Number(speed.toFixed(1)), metrics, ...gps })
  const watched = faulty ? ` · ${faulty.label} ${metrics[faulty.key]}${faulty.unit}(${HEALTH_LABELS[metricState(faulty, metrics[faulty.key])]})` : ''
  const where = result.position ? ` · ${result.position.onRoute ? `${result.position.lap}바퀴째 ${(result.position.progress * 100).toFixed(1)}%` : '경로 밖'}` : ''
  console.log(`${new Date().toLocaleTimeString('ko-KR')} ${speed.toFixed(0)}km/h${watched}${where}`)
  for (const command of result.commands ?? []) {
    if (seen.has(command.id)) continue
    seen.add(command.id)
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
