import { ACTIONS } from '../../../src/shared/api/contract'
import type {
  ActionCode,
  ActionLogEntry,
  FleetFrame,
  HealthState,
  Issue,
  MetricReading,
  VehicleSnapshot,
} from '../../../src/shared/api/contract'
import { findRoute } from '../../../src/shared/config/routes'
import { createRouteGeo, turnRateAt } from '../../../src/shared/lib/route-geo'
import type { RouteGeo } from '../../../src/shared/lib/route-geo'
import { VEHICLE_SPECS } from '../fleet-specs'
import type { MetricSpec, VehicleSpec } from '../fleet-specs'
import { createDriveProfile } from './drive'
import {
  isLiveIssueId,
  lapOf,
  LIVE_READING_MAX_AGE,
  liveActionLog,
  liveIssueMetric,
  liveIssueView,
  liveStateOf,
  metricState,
  RESOLVED_VISIBLE_MS,
  worse,
} from './live'
import type { ActionRecord, LiveIssueRecord, LiveReading } from './types'

export { metricState } from './live'
export type { ActionRecord, CommandAck, LiveIssueRecord, LivePosition, LiveReading } from './types'

/**
 * 시간의 순수 함수로 계산하는 주행 시뮬레이션.
 *
 * 서버리스에서는 요청마다 다른 인스턴스가 응답하므로 메모리에 상태를 둘 수 없습니다.
 * 같은 시각이면 어느 인스턴스든 같은 위치·지표·문제를 내도록, 상태는 시각과
 * 사람이 남긴 기록(원격 조치)만으로 계산합니다. 원격 조치는 DB에 저장합니다.
 *
 * - 속도·위치: 경로 위치마다 낼 수 있는 속도(제한속도·굽이·신호·가감속, drive.ts) × 교통 흐름 배수(사인파).
 *   배수의 적분(유효 시간)으로 위치를 바로 구하고, 속도 제한 구간만 수치 적분으로 뺍니다.
 * - 문제: 45초 칸마다 시드 난수로 '문제 후보'를 뽑고, 하루 시작(KST 0시)부터 차례로 받아들일지 정합니다.
 *   같은 지표에 진행 중인 문제가 있거나 동시에 2건이면 건너뜁니다. 문제는 조치하거나 15분이 지나면 끝납니다.
 * - 지표: 기준값 + 문제로 생긴 치우침(선형으로 커지고, 끝나면 지수로 회복) + 시각으로 정한 잡음
 *
 * 30초 안에 실차 측정값이 들어온 탈것은 측정값·GPS·실측 문제(live.ts)를 시뮬레이션 대신 씁니다.
 */

/** 관제 지도에서 움직임이 보이도록 지도 위치(mapProgress)만 빠르게 돌리는 배속. 바퀴 수와 진행률은 실제 속도 기준입니다. */
export const TIME_SCALE = 12
/** 실차 GPS 궤적: 최근 2분, 최대 60점 */
const GPS_TRAIL_MS = 120_000
const GPS_TRAIL_POINTS = 60
/** 원격 조치를 보낸 뒤 차량이 응답하기까지(ms) */
export const ACTION_LATENCY = 2400
export const SPEED_CAP_DURATION = 90_000
const SLOT_MS = 45_000
const NATURAL_RESOLVE_MS = 15 * 60_000
/**
 * 문제 빈도. 운영은 알림이 너무 잦지 않게 'calm'(동시 2건, 경고 단계 2분 이상)이고,
 * E2E 서버는 언제 열어도 조치할 문제가 있도록 'busy'(KAO_SIM_PROFILE=busy)로 띄웁니다.
 */
const PROFILES = {
  calm: { rateScale: 0.12, probability: 0.12, maxActive: 2 },
  busy: { rateScale: 1, probability: 1, maxActive: 4 },
} as const
const PROFILE = PROFILES[process.env.KAO_SIM_PROFILE === 'busy' ? 'busy' : 'calm']
const FAULT_RATE_SCALE = PROFILE.rateScale
const FAULT_PROBABILITY = PROFILE.probability
const MAX_ACTIVE_FAULTS = PROFILE.maxActive
const RECOVERY_PER_SECOND = 0.35
const RESOLVED_KEEP = 3
const LOG_KEEP = 30
const KST_OFFSET = 9 * 3600_000

interface Episode {
  id: string
  vehicle: VehicleSpec
  metric: MetricSpec
  start: number
  /** 치우침이 멈추는 시각(조치 또는 자연 해소) */
  end: number
  action: ActionRecord | null
}

/** 시드가 같으면 같은 결과를 내는 난수(mulberry32) */
function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash(...parts: Array<string | number>) {
  let h = 2166136261
  for (const part of parts) {
    const text = String(part)
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    h ^= 0x9e3779b9
  }
  return h >>> 0
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const round = (value: number, precision: number) => Math.round(value * 10 ** precision) / 10 ** precision

/** 한국 시간 0시(ms) */
export function dayStartOf(time: number) {
  return Math.floor((time + KST_OFFSET) / 86_400_000) * 86_400_000 - KST_OFFSET
}

// ── 속도와 위치 ────────────────────────────────────────────────────────────

/**
 * 교통 흐름에 따른 속도 배수 m(t): 주행 속도 표(제한속도·굽이·신호)의 몇 배로 달리는지(VehicleSpec.pace 범위).
 * 사인파 두 개의 합이라 적분(유효 시간 E(t) = ∫m dt)을 식으로 바로 구합니다(drive.ts 설명 참고).
 */
function paceWave(vehicle: VehicleSpec) {
  const seed = random(hash('speed', vehicle.id))
  const [low, high] = vehicle.pace
  const mid = (low + high) / 2
  const amp = (high - low) / 2
  const w1 = (2 * Math.PI) / (70 + seed() * 50)
  const w2 = (2 * Math.PI) / (23 + seed() * 20)
  const p1 = seed() * Math.PI * 2
  const p2 = seed() * Math.PI * 2
  return {
    at: (seconds: number) => mid + amp * (0.65 * Math.sin(w1 * seconds + p1) + 0.35 * Math.sin(w2 * seconds + p2)),
    /** ∫m dt(유효 시간 초) */
    integral: (seconds: number) =>
      mid * seconds - amp * ((0.65 / w1) * Math.cos(w1 * seconds + p1) + (0.35 / w2) * Math.cos(w2 * seconds + p2)),
  }
}

/** 신호마다 서는 시간(유효 시간 초). 열에 셋은 녹색이라 서지 않고, 나머지는 8~40초. 같은 신호는 늘 같은 시간입니다. */
function signalDwell(routeId: string, index: number) {
  const value = random(hash('signal', routeId, index))()
  return value < 0.3 ? 0 : 8 + ((value - 0.3) / 0.7) * 32
}

const waves = new Map(VEHICLE_SPECS.map((vehicle) => [vehicle.id, paceWave(vehicle)]))
const drives = new Map(
  VEHICLE_SPECS.map((vehicle) => [
    vehicle.id,
    createDriveProfile(findRoute(vehicle.routeId), {
      topSpeed: vehicle.cruise[1],
      handling: vehicle.handling,
      dwell: (index) => signalDwell(vehicle.routeId, index),
    }),
  ]),
)

const isCapAction = (action: ActionRecord) => action.action === 'speed-limit' || action.action === 'power-limit'

function speedCapAt(vehicle: VehicleSpec, actions: ActionRecord[], time: number): number | null {
  let cap: number | null = null
  for (const action of actions) {
    if (action.vehicleId !== vehicle.id || !isCapAction(action)) continue
    if (time < action.sentAt || time >= action.sentAt + SPEED_CAP_DURATION) continue
    const value = capValue(vehicle, action.action)
    cap = cap === null ? value : Math.min(cap, value)
  }
  return cap
}

/** 속도 제한은 평소 최고 속도의 60%(도심이면 시속 30km), 출력 제한은 80%로 묶습니다. */
export function capValue(vehicle: VehicleSpec, action: ActionCode) {
  const [, high] = vehicle.cruise
  return Math.round(high * (action === 'speed-limit' ? 0.6 : 0.8))
}

/** 실차가 적용했다고 응답한 속도·출력 제한(응답 시각부터 SPEED_CAP_DURATION 동안) */
function liveSpeedCap(vehicle: VehicleSpec, actions: ActionRecord[], now: number): number | null {
  let cap: number | null = null
  for (const action of actions) {
    if (action.vehicleId !== vehicle.id || action.ack?.result !== 'applied' || !isCapAction(action)) continue
    if (now < action.ack.at || now >= action.ack.at + SPEED_CAP_DURATION) continue
    const value = capValue(vehicle, action.action)
    cap = cap === null ? value : Math.min(cap, value)
  }
  return cap
}

/** 거리 기준 시각. 위치가 끊기지 않도록 고정된 시각부터 잽니다. */
const DISTANCE_EPOCH = Date.UTC(2026, 0, 1)
/** 속도 제한 구간을 수치 적분하는 칸(ms) */
const CAP_STEP = 500

const wrap = (value: number, size: number) => ((value % size) + size) % size

/**
 * 고정 시각부터 지금까지의 유효 시간(초). 속도·출력 제한이 걸린 구간(조치마다 90초, 겹치면 더 낮은 제한)은
 * 제한 때문에 덜 달린 만큼을 500ms 칸으로 적분해 뺍니다. 제한 아래에서는 유효 시간이 min(m, 제한 / 표의 속도)로 흐릅니다.
 */
function effectiveTime(vehicle: VehicleSpec, actions: ActionRecord[], time: number) {
  const wave = waves.get(vehicle.id)!
  const drive = drives.get(vehicle.id)!
  const base = (at: number) => wave.integral(at / 1000) - wave.integral(DISTANCE_EPOCH / 1000)
  const windows = actions
    .filter((action) => action.vehicleId === vehicle.id && isCapAction(action) && action.sentAt < time)
    .map((action) => ({ start: action.sentAt, end: action.sentAt + SPEED_CAP_DURATION, cap: capValue(vehicle, action.action) / 3.6 }))
    .sort((a, b) => a.start - b.start)
  let deficit = 0
  let at = windows[0]?.start ?? time
  for (const window of windows) {
    at = Math.max(at, window.start)
    const until = Math.min(window.end, time)
    for (; at < until; at += CAP_STEP) {
      const dt = Math.min(CAP_STEP, until - at) / 1000
      const cap = Math.min(...windows.filter((item) => item.start <= at && at < item.end).map((item) => item.cap))
      const pace = wave.at(at / 1000)
      const { speed } = drive.at(wrap(base(at) - deficit, drive.lapTime))
      const rate = speed * pace > cap ? cap / speed : pace
      deficit += (pace - rate) * dt
    }
  }
  return base(time) - deficit
}

/** 시각 time의 실제 속도(km/h): 주행 속도 표 × 교통 흐름 배수, 속도·출력 제한이 걸려 있으면 그 이하 */
function speedAt(vehicle: VehicleSpec, actions: ActionRecord[], time: number) {
  const drive = drives.get(vehicle.id)!
  const { speed } = drive.at(wrap(effectiveTime(vehicle, actions, time), drive.lapTime))
  const raw = speed * 3.6 * waves.get(vehicle.id)!.at(time / 1000)
  const cap = speedCapAt(vehicle, actions, time)
  return cap === null ? raw : Math.min(raw, cap)
}

/**
 * 경로 위 위치. 바퀴 수(매시 정각부터)와 진행률은 실제로 달린 위치입니다. 관제 지도 위치(mapProgress)는 유효 시간을
 * TIME_SCALE배 한 위치라, 실제로 한 바퀴를 돌면 지도에서는 정확히 TIME_SCALE바퀴를 돌고, 지도에서도 굽이·신호에서 느려집니다.
 * mapSpeed는 지도 위치에서의 속도(km/h, 지도는 이것의 TIME_SCALE배로 움직임)입니다.
 */
function positionAt(vehicle: VehicleSpec, actions: ActionRecord[], time: number) {
  const drive = drives.get(vehicle.id)!
  const effective = effectiveTime(vehicle, actions, time)
  const laps = Math.floor(effective / drive.lapTime)
  const here = drive.at(effective - laps * drive.lapTime)
  const there = drive.at(wrap(effective * TIME_SCALE, drive.lapTime))
  const hourStart = Math.floor(time / 3600_000) * 3600_000
  // 지금 유효 시간이 흐르는 빠르기: 교통 흐름 배수, 속도·출력 제한이 걸려 있으면 제한 / 실제 위치의 표 속도까지
  const pace = waves.get(vehicle.id)!.at(time / 1000)
  const cap = speedCapAt(vehicle, actions, time)
  const rate = cap !== null && here.speed * pace > cap / 3.6 ? cap / 3.6 / here.speed : pace
  return {
    lap: laps - Math.floor(effectiveTime(vehicle, actions, hourStart) / drive.lapTime) + 1,
    progress: here.distance / drive.length,
    mapProgress: there.distance / drive.length,
    mapSpeed: there.speed * 3.6 * rate,
  }
}

// ── 문제(고장) 에피소드 ─────────────────────────────────────────────────────

const faultMetrics = new Map(VEHICLE_SPECS.map((vehicle) => [vehicle.id, vehicle.metrics.filter((metric) => metric.fault)]))

/**
 * 하루치 문제 에피소드. 하루의 모든 칸을 한 번에 계산하고, 조치 기록이 같으면 결과도 같으므로 기억해 둡니다.
 * 아직 오지 않은 칸의 에피소드도 들어 있지만, 시작 전에는 지표에 영향이 없고 문제로도 보이지 않습니다.
 */
const episodeCache = new Map<string, Episode[]>()
const SLOTS_PER_DAY = Math.ceil(86_400_000 / SLOT_MS)

function episodesFor(dayStart: number, actions: ActionRecord[]): Episode[] {
  const key = `${dayStart}:${actions.map((action) => action.id).join(',')}`
  const cached = episodeCache.get(key)
  if (cached) return cached

  const byIssue = new Map(actions.map((action) => [action.issueId, action]))
  const episodes: Episode[] = []
  // 진행 중인 에피소드만 들고 갑니다(최대 MAX_ACTIVE_FAULTS건). 끝난 것은 그때그때 뺍니다.
  let active: Episode[] = []
  for (let slot = 0; slot < SLOTS_PER_DAY; slot += 1) {
    const seed = random(hash('fault', dayStart, slot))
    if (seed() > FAULT_PROBABILITY) continue
    const vehicle = VEHICLE_SPECS[Math.floor(seed() * VEHICLE_SPECS.length)]!
    const metrics = faultMetrics.get(vehicle.id)!
    const metric = metrics[Math.floor(seed() * metrics.length)]!
    const start = dayStart + slot * SLOT_MS + Math.floor(seed() * SLOT_MS * 0.6)
    active = active.filter((episode) => episode.end > start)
    if (active.length >= MAX_ACTIVE_FAULTS) continue
    if (active.some((episode) => episode.vehicle.id === vehicle.id && episode.metric.key === metric.key)) continue
    const id = `${vehicle.id}-${metric.key}-${dayStart / 1000}-${slot}`
    const action = byIssue.get(id) ?? null
    const natural = start + NATURAL_RESOLVE_MS
    const episode: Episode = { id, vehicle, metric, start, end: action ? Math.min(action.sentAt, natural) : natural, action }
    episodes.push(episode)
    active.push(episode)
  }
  if (episodeCache.size > 50) episodeCache.clear()
  episodeCache.set(key, episodes)
  return episodes
}

/** 시각 time 근처에 영향을 줄 수 있는 에피소드만(회복까지 고려해 넉넉히) */
function episodesNear(episodes: Episode[], time: number) {
  return episodes.filter((episode) => episode.start <= time && episode.end + 120_000 >= time - RESOLVED_VISIBLE_MS)
}

function faultRate(metric: MetricSpec) {
  return metric.fault!.rate * FAULT_RATE_SCALE
}

/** 에피소드가 지표를 기준값에서 얼마나 밀어냈는지 */
function offsetAt(episode: Episode, time: number) {
  if (time < episode.start) return 0
  const fault = episode.metric.fault!
  const goal = fault.target - episode.metric.nominal
  const drift = (until: number) => Math.sign(goal) * Math.min((faultRate(episode.metric) * (until - episode.start)) / 1000, Math.abs(goal))
  if (time < episode.end) return drift(time)
  return drift(episode.end) * Math.exp((-RECOVERY_PER_SECOND * (time - episode.end)) / 1000)
}

/** 치우침이 기준선을 넘는 시각. 기울기처럼 늘 출렁이는 지표는 baseline을 기준으로 봅니다. */
function crossingTime(episode: Episode, limit: number | null) {
  if (limit === null) return null
  const metric = episode.metric
  const base = metric.baseline ?? metric.nominal
  const need = Math.abs(limit - base)
  const reach = Math.abs(metric.fault!.target - metric.nominal)
  if (need > reach) return null
  return episode.start + (need / faultRate(metric)) * 1000
}

function issueOf(episode: Episode, time: number): Issue | null {
  const detectedAt = crossingTime(episode, episode.metric.warn)
  if (detectedAt === null || detectedAt > time || detectedAt >= episode.end) return null
  const criticalAt = crossingTime(episode, episode.metric.crit)
  const fault = episode.metric.fault!
  const issue: Issue = {
    id: episode.id,
    vehicleId: episode.vehicle.id,
    metricKey: episode.metric.key,
    severity: criticalAt !== null && criticalAt <= Math.min(time, episode.end) ? 'critical' : 'warning',
    title: fault.title,
    detail: fault.detail,
    detectedAt: Math.round(detectedAt),
    status: 'open',
    actions: [...fault.actions],
    source: 'simulated',
  }
  if (episode.action) {
    const doneAt = episode.action.sentAt + ACTION_LATENCY
    issue.status = time < doneAt ? 'resolving' : 'resolved'
    if (issue.status === 'resolved') {
      issue.resolvedBy = episode.action.action
      issue.resolvedAt = doneAt
    }
  } else if (time >= episode.end) {
    issue.status = 'resolved'
    issue.resolvedAt = episode.end
  }
  return issue
}

// ── 지표 ───────────────────────────────────────────────────────────────────

const geos = new Map<string, RouteGeo>()
/** 경로의 좌표 계산(경로마다 한 번 만들어 둠) */
function routeGeo(routeId: string) {
  let geo = geos.get(routeId)
  if (!geo) {
    geo = createRouteGeo(findRoute(routeId))
    geos.set(routeId, geo)
  }
  return geo
}

/**
 * 지표 값. state를 주면(실차 신호가 있는데 그 지표의 측정값이 빠졌을 때) 시뮬레이션 대신 실차의 속도와
 * 경로 위치로 계산합니다. 예: 서 있는 실차 오토바이의 기울기는 0, 엔진 회전수는 공회전 값.
 */
function metricValue(
  vehicle: VehicleSpec,
  metric: MetricSpec,
  episodes: Episode[],
  actions: ActionRecord[],
  time: number,
  state: { speed?: number; progress?: number } = {},
) {
  const speed = state.speed ?? speedAt(vehicle, actions, time)
  let base = metric.nominal
  if (metric.derive) {
    const progress = state.progress ?? positionAt(vehicle, actions, time).progress
    const curvature = Math.abs(turnRateAt(routeGeo(vehicle.routeId), progress))
    base = metric.derive({ speed, progress, elapsed: time / 1000, curvature })
  }
  let offset = 0
  for (const episode of episodes) {
    if (episode.vehicle.id === vehicle.id && episode.metric.key === metric.key) offset += offsetAt(episode, time)
  }
  const noise = (random(hash('noise', vehicle.id, metric.key, Math.floor(time / 500)))() - 0.5) * 2 * metric.noise
  return clamp(base + offset + noise, metric.min, metric.max)
}

function reading(metric: MetricSpec, value: number): MetricReading {
  return {
    key: metric.key,
    label: metric.label,
    unit: metric.unit,
    value: round(value, metric.precision),
    min: metric.min,
    max: metric.max,
    warn: metric.warn,
    crit: metric.crit,
    direction: metric.direction,
    precision: metric.precision,
    state: metricState(metric, value),
  }
}

// ── 공개 API ───────────────────────────────────────────────────────────────

export interface FrameInput {
  now: number
  /**
   * 오늘(KST) 보낸 원격 조치. 실차 명령은 차량 응답(ack)까지 들어 있습니다.
   * 0시 전 조치가 섞여 있어도 됩니다. 시뮬레이션과 조치 기록은 오늘 것만 쓰고, 실측 문제는 0시 직전에 보낸 명령도 이어서 봅니다.
   */
  actions: ActionRecord[]
  /** 최근 실차 측정값 */
  readings?: LiveReading[]
  /** 실측 문제: 해결되지 않은 것 전부와 오늘 해결한 것 */
  liveIssues?: LiveIssueRecord[]
  /** 볼 수 있는 탈것(없으면 전체) */
  vehicleIds?: readonly string[]
}

function liveIssuesOf(vehicle: VehicleSpec, records: LiveIssueRecord[], actions: ActionRecord[], now: number): Issue[] {
  return records
    .filter((record) => record.vehicleId === vehicle.id)
    .flatMap((record) => {
      const metric = vehicle.metrics.find((item) => item.key === record.metricKey)
      return metric?.fault ? [liveIssueView(record, metric, actions, now)] : []
    })
}

/** 최근 GPS 위치(오래된 것부터). 경로 밖을 달릴 때 관제 지도가 실제 위치와 지나온 길을 그립니다. */
function gpsTrail(readings: LiveReading[], vehicleId: string, now: number): Array<[number, number]> {
  return readings
    .filter((reading) => reading.vehicleId === vehicleId && reading.position && reading.at <= now && now - reading.at <= GPS_TRAIL_MS)
    .sort((a, b) => a.at - b.at)
    .slice(-GPS_TRAIL_POINTS)
    .map((reading) => [round(reading.position!.lat, 6), round(reading.position!.lng, 6)])
}

export function computeFrame({ now, actions, readings = [], liveIssues = [], vehicleIds }: FrameInput): FleetFrame {
  const dayStart = dayStartOf(now)
  const sent = actions.filter((action) => action.sentAt <= now)
  const todays = sent.filter((action) => action.sentAt >= dayStart)
  // 시뮬레이션(위치, 속도, 문제 일정)은 시뮬레이션 문제에 보낸 조치만으로 계산합니다.
  const simulated = todays.filter((action) => !isLiveIssueId(action.issueId))
  const daily = episodesFor(dayStart, simulated)
  const episodes = episodesNear(daily, now)
  const visible = VEHICLE_SPECS.filter((vehicle) => !vehicleIds || vehicleIds.includes(vehicle.id))

  const vehicles = visible.map((vehicle): VehicleSnapshot => {
    const live = liveStateOf(readings, vehicle.id, now)
    // 실차 신호가 들어온 탈것에는 시뮬레이션 문제 대신 실측 문제를 붙입니다.
    const mine = live ? [] : episodes.filter((episode) => episode.vehicle.id === vehicle.id)
    const issues = live
      ? liveIssuesOf(vehicle, liveIssues, sent, now)
      : mine.map((episode) => issueOf(episode, now)).filter((issue): issue is Issue => issue !== null)
    const active = issues.filter((issue) => issue.status !== 'resolved')
    const resolved = issues
      .filter((issue) => issue.status === 'resolved' && now - (issue.resolvedAt ?? 0) <= RESOLVED_VISIBLE_MS)
      .sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0))
      .slice(-RESOLVED_KEEP)
    const gps = live?.position
    const onRoute = gps !== undefined && gps.progress !== null
    const speed = live?.speed ?? speedAt(vehicle, simulated, now)
    // 실차 GPS가 경로 위면 지도에서도 실제 위치·속도 그대로 둡니다(배속 없음).
    const position =
      gps && gps.progress !== null
        ? { progress: gps.progress, mapProgress: gps.progress, lap: lapOf(gps), mapSpeed: speed }
        : positionAt(vehicle, simulated, now)
    const metrics = vehicle.metrics.map((metric) => {
      if (metric.key === 'speed') return reading(metric, clamp(speed, metric.min, metric.max))
      const liveValue = live?.metrics[metric.key]
      if (typeof liveValue === 'number') return reading(metric, clamp(liveValue, metric.min, metric.max))
      // 실차 신호가 있으면 빠진 지표도 실차의 속도와 위치(GPS가 경로 위면 그 위치)로 채웁니다.
      return reading(metric, metricValue(vehicle, metric, mine, simulated, now, live ? { speed, progress: position.progress } : {}))
    })
    const states: HealthState[] = live
      ? [...metrics.map((metric) => metric.state), ...active.map((issue) => issue.severity)]
      : active.map((issue) => issue.severity)
    const health = states.reduce<HealthState>(worse, 'nominal')
    return {
      id: vehicle.id,
      modelId: vehicle.modelId,
      kind: vehicle.kind,
      maker: vehicle.maker,
      model: vehicle.model,
      year: vehicle.year,
      plate: vehicle.plate,
      member: vehicle.member,
      paint: vehicle.paint,
      routeId: vehicle.routeId,
      source: live ? 'live' : 'simulated',
      progress: round(position.progress, 5),
      mapProgress: round(position.mapProgress, 5),
      mapSpeed: round(position.mapSpeed, 1),
      lap: position.lap,
      positionSource: onRoute ? 'gps' : 'simulated',
      gps: gps ? { lat: gps.lat, lng: gps.lng, at: gps.at, onRoute, trail: gpsTrail(readings, vehicle.id, now) } : null,
      speed: round(speed, 1),
      speedCap: live ? liveSpeedCap(vehicle, sent, now) : speedCapAt(vehicle, simulated, now),
      health,
      metrics,
      issues: [...resolved, ...active],
    }
  })

  const visibleIds = new Set(visible.map((vehicle) => vehicle.id))
  const titles = new Map(daily.map((episode) => [episode.id, episode.metric.fault!.title]))
  const liveRecords = new Map(liveIssues.map((record) => [record.id, record]))
  const log: ActionLogEntry[] = todays
    .filter((action) => visibleIds.has(action.vehicleId))
    .flatMap((action) => {
      const vehicle = VEHICLE_SPECS.find((item) => item.id === action.vehicleId)!
      if (isLiveIssueId(action.issueId)) {
        const metricKey = liveIssueMetric(action.issueId, vehicle.id)
        const title = vehicle.metrics.find((metric) => metric.key === metricKey)?.fault?.title ?? '문제'
        return liveActionLog(action, `${vehicle.model} · ${title}: ${ACTIONS[action.action].label}`, now, liveRecords.get(action.issueId))
      }
      const label = `${vehicle.model} · ${titles.get(action.issueId) ?? '문제'}: ${ACTIONS[action.action].label}`
      const entries: ActionLogEntry[] = [
        { id: `${action.id}-sent`, vehicleId: action.vehicleId, issueId: action.issueId, action: action.action, at: action.sentAt, phase: 'sent', message: `${label} 명령 전송` },
      ]
      const doneAt = action.sentAt + ACTION_LATENCY
      if (doneAt <= now) {
        entries.push({ id: `${action.id}-completed`, vehicleId: action.vehicleId, issueId: action.issueId, action: action.action, at: doneAt, phase: 'completed', message: `${label} 완료` })
      }
      return entries
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, LOG_KEEP)

  return { at: now, timeScale: TIME_SCALE, vehicles, log }
}

export type ActionCheck =
  | { ok: true; vehicle: VehicleSpec }
  | { ok: false; statusCode: 404 | 409 | 422; message: string }

/** 지금 이 문제에 이 조치를 보낼 수 있는지 확인합니다. */
export function checkAction(input: Omit<FrameInput, 'vehicleIds'>, vehicleId: string, issueId: string, action: ActionCode): ActionCheck {
  const vehicle = VEHICLE_SPECS.find((item) => item.id === vehicleId)
  if (!vehicle) return { ok: false, statusCode: 404, message: '등록되지 않은 탈것입니다.' }
  const frame = computeFrame({ ...input, vehicleIds: [vehicleId] })
  const issue = frame.vehicles[0]!.issues.find((item) => item.id === issueId)
  if (!issue) return { ok: false, statusCode: 404, message: '문제를 찾지 못했습니다. 이미 정리된 문제일 수 있습니다.' }
  if (issue.status !== 'open') {
    return { ok: false, statusCode: 409, message: '이미 조치 중이거나 해결된 문제입니다. 목록을 새로 확인해 주세요.' }
  }
  if (!issue.actions.includes(action)) {
    return { ok: false, statusCode: 422, message: '이 문제에 쓸 수 없는 조치입니다. 제안된 조치 중에서 골라 주세요.' }
  }
  return { ok: true, vehicle }
}

export interface HistoryInput {
  vehicleId: string
  metricKey: string
  from: number
  to: number
  points: number
  actions: ActionRecord[]
  /** 이 탈것의 실차 측정값(from보다 30초 앞부터 to까지) */
  readings?: LiveReading[]
}

/**
 * 지난 시각의 지표 값. 그 시각 30초 안에 실차 측정값이 있으면 그 값을 쓰고, 없으면 시뮬레이션을 다시 계산합니다
 * (시뮬레이션은 시간의 순수 함수라 따로 저장하지 않습니다). 실차 신호가 있던 시각에 보내지 않은 지표는
 * 화면과 같게 시뮬레이션 문제 없이 계산합니다.
 */
export function computeHistory({ vehicleId, metricKey, from, to, points, actions, readings = [] }: HistoryInput) {
  const vehicle = VEHICLE_SPECS.find((item) => item.id === vehicleId)
  const metric = vehicle?.metrics.find((item) => item.key === metricKey)
  if (!vehicle || !metric) return null
  const mine = readings.filter((item) => item.vehicleId === vehicleId).sort((a, b) => a.at - b.at)
  const step = (to - from) / Math.max(1, points - 1)
  const samples: Array<{ at: number; value: number }> = []
  let cursor = 0
  let liveSamples = 0
  for (let i = 0; i < points; i += 1) {
    const at = Math.round(from + step * i)
    while (cursor < mine.length && mine[cursor]!.at <= at) cursor += 1
    let live = false
    let liveValue: number | undefined
    // 이 지표의 측정값이 없을 때 쓸, 그 시각 실차의 가장 새 속도와 위치. 가장 새 GPS가 경로 밖이면
    // 더 오래된 경로 위 위치를 찾지 않고 시뮬레이션 위치를 씁니다(관제 프레임과 같게).
    let liveSpeed: number | undefined
    let liveProgress: number | undefined
    let positionSeen = false
    for (let j = cursor - 1; j >= 0 && at - mine[j]!.at <= LIVE_READING_MAX_AGE; j -= 1) {
      live = true
      const item = mine[j]!
      liveSpeed ??= item.speed
      if (!positionSeen && item.position) {
        positionSeen = true
        liveProgress = item.position.progress ?? undefined
      }
      const value = metric.key === 'speed' ? item.speed : item.metrics[metric.key]
      if (typeof value === 'number') {
        liveValue = value
        break
      }
    }
    let value: number
    if (liveValue !== undefined) {
      value = clamp(liveValue, metric.min, metric.max)
      liveSamples += 1
    } else {
      const dayStart = dayStartOf(at)
      const todays = actions.filter((action) => action.sentAt >= dayStart && action.sentAt <= at && !isLiveIssueId(action.issueId))
      const episodes = live ? [] : episodesNear(episodesFor(dayStart, todays), at).filter((episode) => episode.vehicle.id === vehicleId)
      value =
        metric.key === 'speed'
          ? speedAt(vehicle, todays, at)
          : metricValue(vehicle, metric, episodes, todays, at, live ? { speed: liveSpeed, progress: liveProgress } : {})
    }
    samples.push({ at, value: round(value, metric.precision) })
  }
  return { metric: reading(metric, samples.at(-1)?.value ?? metric.nominal), samples, liveSamples }
}

/** 지금 위험 등급인 열린 문제(웹 푸시 알림 대상) */
export function criticalIssues(input: Omit<FrameInput, 'vehicleIds'>) {
  return computeFrame(input).vehicles.flatMap((vehicle) =>
    vehicle.issues
      .filter((issue) => issue.status === 'open' && issue.severity === 'critical')
      .map((issue) => ({ vehicle, issue })),
  )
}
