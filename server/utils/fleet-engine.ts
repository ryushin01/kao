import { ACTIONS } from '../../src/shared/api/contract'
import type {
  ActionLogEntry,
  FleetFrame,
  HealthState,
  Issue,
  MetricReading,
  RemoteActionRequest,
  RemoteActionResponse,
  VehicleSnapshot,
} from '../../src/shared/api/contract'
import { findRoute } from '../../src/shared/config/routes'
import { VEHICLE_SPECS } from './fleet-specs'
import type { MetricSpec, VehicleSpec } from './fleet-specs'

/** 위치 이동에만 쓰는 배속. 실제 속도로는 한 바퀴에 수십 분이 걸려 화면에서 움직임이 보이지 않습니다. */
const TIME_SCALE = 12
/** 원격 조치를 보낸 뒤 차량이 응답하기까지 걸리는 시간(ms) */
export const ACTION_LATENCY = 2400
const RESOLVED_KEEP = 3
const LOG_KEEP = 30
const MAX_ACTIVE_FAULTS = 3
const SPEED_CAP_DURATION = 90_000
/** 문제가 나빠지는 속도 배율. 경고에서 위험까지 1분 안팎이 걸리게 합니다. */
const FAULT_RATE_SCALE = 0.3

export class RemoteActionError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message)
  }
}

interface MetricState {
  spec: MetricSpec
  offset: number
  faultActive: boolean
  value: number
}

interface PendingAction {
  issueId: string
  action: RemoteActionRequest['action']
  completeAt: number
}

interface VehicleState {
  spec: VehicleSpec
  progress: number
  lap: number
  speed: number
  phase: number
  speedCap: number | null
  speedCapUntil: number
  metrics: MetricState[]
  issues: Issue[]
  pending: PendingAction[]
}

/** 시드가 같으면 같은 결과를 내는 난수(mulberry32) */
function createRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const round = (value: number, precision: number) => {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

export function metricState(spec: Pick<MetricSpec, 'warn' | 'crit' | 'direction'>, value: number): HealthState {
  const beyond = (limit: number | null) =>
    limit !== null && (spec.direction === 'high' ? value >= limit : value <= limit)
  if (beyond(spec.crit)) return 'critical'
  if (beyond(spec.warn)) return 'warning'
  return 'nominal'
}

const SEVERITY_RANK: Record<HealthState, number> = { nominal: 0, warning: 1, critical: 2 }

export interface FleetEngineOptions {
  seed?: number
  now?: number
  /** 시작할 때 미리 걸어 둘 문제(차량 id, 지표 key) */
  initialFaults?: Array<[string, string]>
  /** 새 문제가 생기는 간격(ms) 범위 */
  faultInterval?: readonly [number, number]
}

export function createFleetEngine(options: FleetEngineOptions = {}) {
  const random = createRandom(options.seed ?? 20261112)
  const [intervalMin, intervalMax] = options.faultInterval ?? [16_000, 32_000]
  const startedAt = options.now ?? Date.now()
  let lastTick = startedAt
  let issueSeq = 0
  let logSeq = 0
  let nextFaultAt = startedAt + intervalMin
  const log: ActionLogEntry[] = []

  const vehicles: VehicleState[] = VEHICLE_SPECS.map((spec, index) => {
    const [low, high] = spec.cruise
    return {
      spec,
      progress: (index * 0.27) % 1,
      lap: 1,
      speed: (low + high) / 2,
      phase: random() * Math.PI * 2,
      speedCap: null,
      speedCapUntil: 0,
      metrics: spec.metrics.map((metric) => ({ spec: metric, offset: 0, faultActive: false, value: metric.nominal })),
      issues: [],
      pending: [],
    }
  })

  const findVehicle = (id: string) => vehicles.find((vehicle) => vehicle.spec.id === id)

  function activateFault(vehicle: VehicleState, metric: MetricState, preload = false) {
    const fault = metric.spec.fault
    if (!fault) return
    metric.faultActive = true
    if (preload) {
      // 시작 화면에 바로 경고가 보이도록 경고 기준을 살짝 넘긴 상태에서 출발합니다.
      const limit = metric.spec.warn ?? metric.spec.nominal
      const push = metric.spec.direction === 'high' ? 1 : -1
      metric.offset = limit - metric.spec.nominal + push * Math.abs(fault.target - limit) * 0.15
    }
  }

  for (const [vehicleId, metricKey] of options.initialFaults ?? []) {
    const vehicle = findVehicle(vehicleId)
    const metric = vehicle?.metrics.find((item) => item.spec.key === metricKey)
    if (vehicle && metric) activateFault(vehicle, metric, true)
  }

  function injectRandomFault() {
    const active = vehicles.reduce((sum, vehicle) => sum + vehicle.metrics.filter((m) => m.faultActive).length, 0)
    if (active >= MAX_ACTIVE_FAULTS) return
    const candidates = vehicles.flatMap((vehicle) =>
      vehicle.metrics
        .filter((metric) => metric.spec.fault && !metric.faultActive && metric.offset === 0)
        .filter((metric) => !vehicle.issues.some((issue) => issue.metricKey === metric.spec.key && issue.status !== 'resolved'))
        .map((metric) => ({ vehicle, metric })),
    )
    const pick = candidates[Math.floor(random() * candidates.length)]
    if (pick) activateFault(pick.vehicle, pick.metric)
  }

  function computeValue(vehicle: VehicleState, metric: MetricState, elapsed: number) {
    const { spec } = metric
    const base = spec.derive
      ? spec.derive({ speed: vehicle.speed, progress: vehicle.progress, elapsed })
      : spec.nominal
    const noise = (random() - 0.5) * 2 * spec.noise
    return clamp(base + metric.offset + noise, spec.min, spec.max)
  }

  function syncIssues(vehicle: VehicleState, now: number) {
    for (const metric of vehicle.metrics) {
      const fault = metric.spec.fault
      if (!fault) continue
      const state = metricState(metric.spec, metric.value)
      const current = vehicle.issues.find((issue) => issue.metricKey === metric.spec.key && issue.status !== 'resolved')

      if (!current && state !== 'nominal' && metric.faultActive) {
        issueSeq += 1
        vehicle.issues.push({
          id: `${vehicle.spec.id}-${metric.spec.key}-${issueSeq}`,
          vehicleId: vehicle.spec.id,
          metricKey: metric.spec.key,
          severity: state,
          title: fault.title,
          detail: fault.detail,
          detectedAt: now,
          status: 'open',
          actions: [...fault.actions],
        })
      } else if (current && current.status === 'open' && state === 'critical') {
        current.severity = 'critical'
      }
    }

    const resolved = vehicle.issues.filter((issue) => issue.status === 'resolved')
    if (resolved.length > RESOLVED_KEEP) {
      const drop = new Set(resolved.slice(0, resolved.length - RESOLVED_KEEP).map((issue) => issue.id))
      vehicle.issues = vehicle.issues.filter((issue) => !drop.has(issue.id))
    }
  }

  function pushLog(entry: Omit<ActionLogEntry, 'id'>) {
    logSeq += 1
    const full = { ...entry, id: `log-${logSeq}` }
    log.unshift(full)
    log.length = Math.min(log.length, LOG_KEEP)
    return full
  }

  function completeActions(vehicle: VehicleState, now: number) {
    const due = vehicle.pending.filter((item) => item.completeAt <= now)
    if (due.length === 0) return
    vehicle.pending = vehicle.pending.filter((item) => item.completeAt > now)
    for (const item of due) {
      const issue = vehicle.issues.find((entry) => entry.id === item.issueId)
      if (!issue) continue
      issue.status = 'resolved'
      issue.resolvedBy = item.action
      issue.resolvedAt = now
      pushLog({
        vehicleId: vehicle.spec.id,
        issueId: issue.id,
        action: item.action,
        at: now,
        phase: 'completed',
        message: `${vehicle.spec.model} · ${issue.title}: ${ACTIONS[item.action].label} 완료`,
      })
    }
  }

  function step(vehicle: VehicleState, dt: number, now: number) {
    const seconds = dt / 1000
    const elapsed = (now - startedAt) / 1000
    if (vehicle.speedCap !== null && now >= vehicle.speedCapUntil) vehicle.speedCap = null

    const [low, high] = vehicle.spec.cruise
    const wave = 0.5 + 0.5 * Math.sin(elapsed * 0.11 + vehicle.phase) * Math.cos(elapsed * 0.037 + vehicle.phase)
    const target = Math.min(low + (high - low) * wave, vehicle.speedCap ?? Number.POSITIVE_INFINITY)
    vehicle.speed += (target - vehicle.speed) * Math.min(1, seconds * 0.8)

    const route = findRoute(vehicle.spec.routeId)
    const distanceKm = (vehicle.speed / 3600) * seconds * TIME_SCALE
    vehicle.progress += distanceKm / route.lengthKm
    while (vehicle.progress >= 1) {
      vehicle.progress -= 1
      vehicle.lap += 1
    }

    for (const metric of vehicle.metrics) {
      const fault = metric.spec.fault
      if (metric.faultActive && fault) {
        // 문제가 있는 동안 지표가 나쁜 쪽으로 천천히 움직입니다.
        const goal = fault.target - metric.spec.nominal
        const delta = Math.sign(goal - metric.offset) * fault.rate * FAULT_RATE_SCALE * seconds
        metric.offset = Math.abs(goal - metric.offset) <= Math.abs(delta) ? goal : metric.offset + delta
      } else if (metric.offset !== 0) {
        // 조치가 끝나면 기준값으로 돌아갑니다.
        metric.offset *= Math.max(0, 1 - seconds * 0.35)
        if (Math.abs(metric.offset) < 0.01) metric.offset = 0
      }
      metric.value = computeValue(vehicle, metric, elapsed)
    }

    completeActions(vehicle, now)
    syncIssues(vehicle, now)
  }

  function tick(now = Date.now()) {
    // 오래 비어 있던 뒤에도 한 번에 크게 건너뛰지 않도록 간격을 나눕니다.
    while (lastTick < now) {
      const dt = Math.min(500, now - lastTick)
      lastTick += dt
      for (const vehicle of vehicles) step(vehicle, dt, lastTick)
      if (lastTick >= nextFaultAt) {
        injectRandomFault()
        nextFaultAt = lastTick + intervalMin + random() * (intervalMax - intervalMin)
      }
    }
  }

  function snapshot(vehicle: VehicleState): VehicleSnapshot {
    const metrics: MetricReading[] = vehicle.metrics.map(({ spec, value }) => ({
      key: spec.key,
      label: spec.label,
      unit: spec.unit,
      value: round(value, spec.precision),
      min: spec.min,
      max: spec.max,
      warn: spec.warn,
      crit: spec.crit,
      direction: spec.direction,
      precision: spec.precision,
      state: metricState(spec, value),
    }))
    const active = vehicle.issues.filter((issue) => issue.status !== 'resolved')
    const health = active.reduce<HealthState>(
      (worst, issue) => (SEVERITY_RANK[issue.severity] > SEVERITY_RANK[worst] ? issue.severity : worst),
      'nominal',
    )
    const { spec } = vehicle
    return {
      id: spec.id,
      modelId: spec.modelId,
      kind: spec.kind,
      maker: spec.maker,
      model: spec.model,
      year: spec.year,
      plate: spec.plate,
      member: spec.member,
      paint: spec.paint,
      routeId: spec.routeId,
      progress: round(vehicle.progress, 5),
      lap: vehicle.lap,
      speed: round(vehicle.speed, 1),
      speedCap: vehicle.speedCap,
      health,
      metrics,
      issues: vehicle.issues.map((issue) => ({ ...issue, actions: [...issue.actions] })),
    }
  }

  function frame(): FleetFrame {
    return { at: lastTick, timeScale: TIME_SCALE, vehicles: vehicles.map(snapshot), log: log.map((entry) => ({ ...entry })) }
  }

  function applyAction(vehicleId: string, request: RemoteActionRequest, now = Date.now()): RemoteActionResponse {
    tick(now)
    const vehicle = findVehicle(vehicleId)
    if (!vehicle) throw new RemoteActionError('등록되지 않은 탈것입니다.', 404)
    const issue = vehicle.issues.find((item) => item.id === request.issueId)
    if (!issue) throw new RemoteActionError('문제를 찾지 못했습니다. 이미 정리된 문제일 수 있습니다.', 404)
    if (issue.status !== 'open') {
      throw new RemoteActionError('이미 조치 중이거나 해결된 문제입니다. 목록을 새로 확인해 주세요.', 409)
    }
    if (!issue.actions.includes(request.action)) {
      throw new RemoteActionError('이 문제에 쓸 수 없는 조치입니다. 제안된 조치 중에서 골라 주세요.', 422)
    }

    issue.status = 'resolving'
    const metric = vehicle.metrics.find((item) => item.spec.key === issue.metricKey)
    if (metric) metric.faultActive = false
    if (request.action === 'speed-limit' || request.action === 'power-limit') {
      const [, high] = vehicle.spec.cruise
      vehicle.speedCap = request.action === 'speed-limit' ? Math.min(80, high) : Math.round(high * 0.6)
      vehicle.speedCapUntil = now + SPEED_CAP_DURATION
    }
    vehicle.pending.push({ issueId: issue.id, action: request.action, completeAt: now + ACTION_LATENCY })

    const entry = pushLog({
      vehicleId,
      issueId: issue.id,
      action: request.action,
      at: now,
      phase: 'sent',
      message: `${vehicle.spec.model} · ${issue.title}: ${ACTIONS[request.action].label} 명령 전송`,
    })
    return { entry, vehicle: snapshot(vehicle) }
  }

  tick(startedAt)

  return { tick, frame, applyAction }
}

export type FleetEngine = ReturnType<typeof createFleetEngine>
