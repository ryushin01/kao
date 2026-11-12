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
import { VEHICLE_SPECS } from '../fleet-specs'
import type { MetricSpec, VehicleSpec } from '../fleet-specs'

/**
 * 시간의 순수 함수로 계산하는 주행 시뮬레이션.
 *
 * 서버리스에서는 요청마다 다른 인스턴스가 응답하므로 메모리에 상태를 둘 수 없습니다.
 * 같은 시각이면 어느 인스턴스든 같은 위치·지표·문제를 내도록, 상태는 시각과
 * 사람이 남긴 기록(원격 조치)만으로 계산합니다. 원격 조치는 DB에 저장합니다.
 *
 * - 속도: 사인파의 합이라 거리(적분)를 바로 구할 수 있습니다. 속도 제한 구간만 수치 적분으로 뺍니다.
 * - 문제: 45초 칸마다 시드 난수로 '문제 후보'를 뽑고, 하루 시작(KST 0시)부터 차례로 받아들일지 정합니다.
 *   같은 지표에 진행 중인 문제가 있거나 동시에 2건이면 건너뜁니다. 문제는 조치하거나 15분이 지나면 끝납니다.
 * - 지표: 기준값 + 문제로 생긴 치우침(선형으로 커지고, 끝나면 지수로 회복) + 시각으로 정한 잡음
 */

/** 위치 이동에만 쓰는 배속 */
export const TIME_SCALE = 12
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
const RESOLVED_VISIBLE_MS = 20 * 60_000
const LOG_KEEP = 30
const LIVE_READING_MAX_AGE = 30_000
const KST_OFFSET = 9 * 3600_000

export interface ActionRecord {
  id: string
  issueId: string
  vehicleId: string
  action: ActionCode
  sentAt: number
}

/** 실제 차량에서 들어온 최근 측정값 */
export interface LiveReading {
  vehicleId: string
  at: number
  speed?: number
  metrics: Record<string, number>
}

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

export function metricState(spec: Pick<MetricSpec, 'warn' | 'crit' | 'direction'>, value: number): HealthState {
  const beyond = (limit: number | null) => limit !== null && (spec.direction === 'high' ? value >= limit : value <= limit)
  if (beyond(spec.crit)) return 'critical'
  if (beyond(spec.warn)) return 'warning'
  return 'nominal'
}

const SEVERITY_RANK: Record<HealthState, number> = { nominal: 0, warning: 1, critical: 2 }

// ── 속도와 위치 ────────────────────────────────────────────────────────────

function speedWave(vehicle: VehicleSpec) {
  const seed = random(hash('speed', vehicle.id))
  const [low, high] = vehicle.cruise
  const mid = (low + high) / 2
  const amp = (high - low) / 2
  const w1 = (2 * Math.PI) / (70 + seed() * 50)
  const w2 = (2 * Math.PI) / (23 + seed() * 20)
  const p1 = seed() * Math.PI * 2
  const p2 = seed() * Math.PI * 2
  return {
    /** km/h */
    at: (seconds: number) => mid + amp * (0.65 * Math.sin(w1 * seconds + p1) + 0.35 * Math.sin(w2 * seconds + p2)),
    /** ∫v dt (km/h·s) */
    integral: (seconds: number) =>
      mid * seconds - amp * ((0.65 / w1) * Math.cos(w1 * seconds + p1) + (0.35 / w2) * Math.cos(w2 * seconds + p2)),
  }
}

const waves = new Map(VEHICLE_SPECS.map((vehicle) => [vehicle.id, speedWave(vehicle)]))

function speedCapAt(vehicle: VehicleSpec, actions: ActionRecord[], time: number): number | null {
  let cap: number | null = null
  for (const action of actions) {
    if (action.vehicleId !== vehicle.id || (action.action !== 'speed-limit' && action.action !== 'power-limit')) continue
    if (time < action.sentAt || time >= action.sentAt + SPEED_CAP_DURATION) continue
    const value = capValue(vehicle, action.action)
    cap = cap === null ? value : Math.min(cap, value)
  }
  return cap
}

function capValue(vehicle: VehicleSpec, action: ActionCode) {
  const [, high] = vehicle.cruise
  return action === 'speed-limit' ? Math.min(80, high) : Math.round(high * 0.6)
}

function speedAt(vehicle: VehicleSpec, actions: ActionRecord[], time: number) {
  const raw = waves.get(vehicle.id)!.at(time / 1000)
  const cap = speedCapAt(vehicle, actions, time)
  return cap === null ? raw : Math.min(raw, cap)
}

/** 거리 기준 시각. 위치가 끊기지 않도록 고정된 시각부터 잽니다. */
const DISTANCE_EPOCH = Date.UTC(2026, 0, 1)

/** 경로 위 위치와, 매시 정각부터 센 바퀴 수 */
function positionAt(vehicle: VehicleSpec, actions: ActionRecord[], time: number) {
  const wave = waves.get(vehicle.id)!
  const length = findRoute(vehicle.routeId).lengthKm
  const lapsAt = (at: number) => {
    let distance = wave.integral(at / 1000) - wave.integral(DISTANCE_EPOCH / 1000)
    // 속도 제한이 걸린 구간은 제한을 넘은 만큼 덜 달렸습니다(오늘 보낸 조치만 반영).
    for (const action of actions) {
      if (action.vehicleId !== vehicle.id || (action.action !== 'speed-limit' && action.action !== 'power-limit')) continue
      const to = Math.min(action.sentAt + SPEED_CAP_DURATION, at)
      const cap = capValue(vehicle, action.action)
      for (let t = action.sentAt; t < to; t += 500) distance -= (Math.max(0, wave.at(t / 1000) - cap) * Math.min(500, to - t)) / 1000
    }
    return (distance / 3600) * TIME_SCALE / length
  }
  const laps = lapsAt(time)
  const hourStart = Math.floor(time / 3600_000) * 3600_000
  return { lap: Math.floor(laps) - Math.floor(lapsAt(hourStart)) + 1, progress: laps - Math.floor(laps) }
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

function metricValue(vehicle: VehicleSpec, metric: MetricSpec, episodes: Episode[], actions: ActionRecord[], time: number, withNoise = true) {
  const speed = speedAt(vehicle, actions, time)
  const base = metric.derive
    ? metric.derive({ speed, progress: positionAt(vehicle, actions, time).progress, elapsed: time / 1000 })
    : metric.nominal
  let offset = 0
  for (const episode of episodes) {
    if (episode.vehicle.id === vehicle.id && episode.metric.key === metric.key) offset += offsetAt(episode, time)
  }
  const noise = withNoise ? (random(hash('noise', vehicle.id, metric.key, Math.floor(time / 500)))() - 0.5) * 2 * metric.noise : 0
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
  /** 오늘(KST) 보낸 원격 조치 */
  actions: ActionRecord[]
  readings?: LiveReading[]
  /** 볼 수 있는 탈것(없으면 전체) */
  vehicleIds?: readonly string[]
}

export function computeFrame({ now, actions, readings = [], vehicleIds }: FrameInput): FleetFrame {
  const dayStart = dayStartOf(now)
  const todays = actions.filter((action) => action.sentAt >= dayStart && action.sentAt <= now)
  const episodes = episodesNear(episodesFor(dayStart, todays), now)
  const visible = VEHICLE_SPECS.filter((vehicle) => !vehicleIds || vehicleIds.includes(vehicle.id))

  const vehicles = visible.map((vehicle): VehicleSnapshot => {
    const live = readings
      .filter((item) => item.vehicleId === vehicle.id && now - item.at <= LIVE_READING_MAX_AGE)
      .sort((a, b) => b.at - a.at)[0]
    const mine = episodes.filter((episode) => episode.vehicle.id === vehicle.id)
    const issues = mine.map((episode) => issueOf(episode, now)).filter((issue): issue is Issue => issue !== null)
    const active = issues.filter((issue) => issue.status !== 'resolved')
    const resolved = issues
      .filter((issue) => issue.status === 'resolved' && now - (issue.resolvedAt ?? 0) <= RESOLVED_VISIBLE_MS)
      .slice(-RESOLVED_KEEP)
    const health = active.reduce<HealthState>(
      (worst, issue) => (SEVERITY_RANK[issue.severity] > SEVERITY_RANK[worst] ? issue.severity : worst),
      'nominal',
    )
    const position = positionAt(vehicle, todays, now)
    const simulatedSpeed = speedAt(vehicle, todays, now)
    const speed = live?.speed ?? simulatedSpeed
    const metrics = vehicle.metrics.map((metric) => {
      if (metric.key === 'speed') return reading(metric, speed)
      const liveValue = live?.metrics[metric.key]
      return reading(metric, typeof liveValue === 'number' ? liveValue : metricValue(vehicle, metric, mine, todays, now))
    })
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
      lap: position.lap,
      speed: round(speed, 1),
      speedCap: speedCapAt(vehicle, todays, now),
      health,
      metrics,
      issues: [...resolved, ...active],
    }
  })

  const visibleIds = new Set(visible.map((vehicle) => vehicle.id))
  const titles = new Map(episodes.map((episode) => [episode.id, episode.metric.fault!.title]))
  const log: ActionLogEntry[] = todays
    .filter((action) => visibleIds.has(action.vehicleId))
    .flatMap((action) => {
      const vehicle = VEHICLE_SPECS.find((item) => item.id === action.vehicleId)!
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
export function checkAction(now: number, actions: ActionRecord[], vehicleId: string, issueId: string, action: ActionCode): ActionCheck {
  const vehicle = VEHICLE_SPECS.find((item) => item.id === vehicleId)
  if (!vehicle) return { ok: false, statusCode: 404, message: '등록되지 않은 탈것입니다.' }
  const frame = computeFrame({ now, actions, vehicleIds: [vehicleId] })
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
}

/** 지난 시각의 지표 값을 다시 계산합니다(시간의 순수 함수이므로 따로 저장하지 않습니다). */
export function computeHistory({ vehicleId, metricKey, from, to, points, actions }: HistoryInput) {
  const vehicle = VEHICLE_SPECS.find((item) => item.id === vehicleId)
  const metric = vehicle?.metrics.find((item) => item.key === metricKey)
  if (!vehicle || !metric) return null
  const step = (to - from) / Math.max(1, points - 1)
  const samples: Array<{ at: number; value: number }> = []
  for (let i = 0; i < points; i += 1) {
    const at = Math.round(from + step * i)
    const dayStart = dayStartOf(at)
    const todays = actions.filter((action) => action.sentAt >= dayStart && action.sentAt <= at)
    const episodes = episodesNear(episodesFor(dayStart, todays), at).filter((episode) => episode.vehicle.id === vehicleId)
    const value = metric.key === 'speed' ? speedAt(vehicle, todays, at) : metricValue(vehicle, metric, episodes, todays, at)
    samples.push({ at, value: round(value, metric.precision) })
  }
  return { metric: reading(metric, samples.at(-1)?.value ?? metric.nominal), samples }
}

/** 지금 위험 등급인 열린 문제(웹 푸시 알림 대상) */
export function criticalIssues(now: number, actions: ActionRecord[]) {
  return computeFrame({ now, actions }).vehicles.flatMap((vehicle) =>
    vehicle.issues
      .filter((issue) => issue.status === 'open' && issue.severity === 'critical')
      .map((issue) => ({ vehicle, issue })),
  )
}
