import type { ActionLogEntry, HealthState, Issue } from '../../../src/shared/api/contract'
import type { MetricSpec, VehicleSpec } from '../fleet-specs'
import type { ActionRecord, LiveIssueRecord, LivePosition, LiveReading } from './types'

/**
 * 실차(실제 차량) 연동. 시뮬레이션처럼 저장된 기록(측정값, 실측 문제, 명령과 차량 응답)만으로 상태를 계산합니다.
 *
 * - 측정값이 경고 기준을 넘으면 문제를 열고, 위험 기준을 넘으면 등급을 올립니다(내리지 않습니다).
 * - 지표가 기준 안으로 돌아와 CLEAR_HOLD 동안 유지되면 해결합니다. 차량 응답을 기다리는 명령이 있으면 응답까지 기다립니다.
 * - 원격 조치는 명령으로 쌓였다가 차량이 받아 가고, 차량이 적용(applied)·실패(failed)로 응답합니다.
 *   ACK_TIMEOUT 안에 응답이 없거나 실패하면 문제를 다시 열어 다른 조치를 보낼 수 있습니다.
 *   적용했는데 RECOVERY_TIMEOUT이 지나도 지표가 돌아오지 않을 때도 다시 엽니다.
 */

/** 이 시간 안에 측정값이 들어온 탈것은 실차 신호로 봅니다(ms). */
export const LIVE_READING_MAX_AGE = 30_000
/** 지표가 기준 안으로 돌아온 뒤 이만큼 유지되면 해결합니다(ms). */
export const CLEAR_HOLD = 10_000
/** 차량이 명령에 응답해야 하는 시간(ms) */
export const ACK_TIMEOUT = 120_000
/** 명령을 적용한 뒤 지표가 기준 안으로 돌아오기를 기다리는 시간(ms) */
export const RECOVERY_TIMEOUT = 10 * 60_000
/** 명령이 상태에 영향을 주는 최대 시간: 응답 대기 + 회복 대기. 0시 직전에 보낸 명령도 이만큼은 계속 봅니다. */
export const COMMAND_WINDOW = ACK_TIMEOUT + RECOVERY_TIMEOUT

export const SEVERITY_RANK: Record<HealthState, number> = { nominal: 0, warning: 1, critical: 2 }

export function worse<T extends HealthState>(a: T, b: T): T {
  return SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a
}

export function metricState(spec: Pick<MetricSpec, 'warn' | 'crit' | 'direction'>, value: number): HealthState {
  const beyond = (limit: number | null) => limit !== null && (spec.direction === 'high' ? value >= limit : value <= limit)
  if (beyond(spec.crit)) return 'critical'
  if (beyond(spec.warn)) return 'warning'
  return 'nominal'
}

const LIVE_PREFIX = 'live-'

export const isLiveIssueId = (id: string) => id.startsWith(LIVE_PREFIX)

export const liveIssueId = (vehicleId: string, metricKey: string, detectedAt: number) => `${LIVE_PREFIX}${vehicleId}-${metricKey}-${detectedAt}`

/** 실측 문제 id에서 지표 key를 꺼냅니다(id 모양: live-<탈것>-<지표>-<감지 시각>). */
export function liveIssueMetric(id: string, vehicleId: string) {
  const prefix = `${LIVE_PREFIX}${vehicleId}-`
  if (!id.startsWith(prefix)) return null
  const rest = id.slice(prefix.length)
  const cut = rest.lastIndexOf('-')
  return cut > 0 ? rest.slice(0, cut) : null
}

// ── 측정값 ─────────────────────────────────────────────────────────────────

export interface LiveState {
  /** 가장 최근 측정 시각 */
  at: number
  speed?: number
  metrics: Record<string, number>
  position?: LivePosition & { at: number }
}

/** 최근 30초 안의 측정값을 지표마다 가장 새 값으로 합칩니다. 장치가 지표를 나눠 보내도 됩니다. */
export function liveStateOf(readings: readonly LiveReading[], vehicleId: string, now: number): LiveState | null {
  const recent = readings
    .filter((reading) => reading.vehicleId === vehicleId && now - reading.at <= LIVE_READING_MAX_AGE)
    .sort((a, b) => b.at - a.at)
  const latest = recent[0]
  if (!latest) return null
  const state: LiveState = { at: latest.at, metrics: {} }
  for (const reading of recent) {
    if (state.speed === undefined && reading.speed !== undefined) state.speed = reading.speed
    for (const [key, value] of Object.entries(reading.metrics)) if (!(key in state.metrics)) state.metrics[key] = value
    if (!state.position && reading.position) state.position = { ...reading.position, at: reading.at }
  }
  return state
}

/** GPS로 잰 바퀴 수(매시 정각부터 1바퀴째) */
export const lapOf = (position: Pick<LivePosition, 'odometer'>) => Math.max(1, Math.floor(position.odometer) + 1)

/**
 * 새 GPS 위치의 누적 거리. 같은 시간대(정각부터 한 시간)의 바로 앞 위치와의 차이를 더합니다.
 * 차이는 경로를 따라 더 가까운 쪽으로 잽니다(출발선을 지나면 0.98 → 0.02가 +0.04).
 */
export function nextOdometer(previous: { at: number; position: LivePosition } | null, progress: number | null, at: number) {
  const sameHour = previous !== null && Math.floor(previous.at / 3600_000) === Math.floor(at / 3600_000)
  if (!previous || !sameHour) return progress ?? 0
  const before = previous.position.progress
  if (before === null || progress === null) return previous.position.odometer
  let delta = progress - before
  if (delta > 0.5) delta -= 1
  if (delta < -0.5) delta += 1
  return previous.position.odometer + delta
}

// ── 명령 ───────────────────────────────────────────────────────────────────

/** 문제에 보낸 마지막 명령. 실측 문제는 실패하거나 응답이 없으면 다시 보낼 수 있어 여러 개일 수 있습니다. */
export function lastCommand(issueId: string, actions: readonly ActionRecord[]) {
  let last: ActionRecord | undefined
  for (const action of actions) if (action.issueId === issueId && (!last || action.sentAt >= last.sentAt)) last = action
  return last
}

/** awaiting: 차량 응답을 기다림, recovering: 차량이 적용했고 지표가 돌아오기를 기다림, null: 다시 조치할 수 있음 */
export function commandStage(action: ActionRecord | undefined, now: number): 'awaiting' | 'recovering' | null {
  if (!action) return null
  if (!action.ack) return now - action.sentAt < ACK_TIMEOUT ? 'awaiting' : null
  if (action.ack.result === 'applied') return now - action.ack.at < RECOVERY_TIMEOUT ? 'recovering' : null
  return null
}

/** 차량이 아직 받거나 응답할 수 있는 명령인지 */
export const isPendingCommand = (action: ActionRecord, now: number) =>
  isLiveIssueId(action.issueId) && !action.ack && now - action.sentAt < ACK_TIMEOUT

// ── 실측 문제 ──────────────────────────────────────────────────────────────

export interface LiveIssueChange {
  record: LiveIssueRecord
  /** 이미 있던 문제를 바꿀 때, 판단에 쓴 저장 상태(저장소가 그사이 바뀌었는지 확인) */
  previous: LiveIssueRecord | null
}

export interface EvaluateInput {
  vehicle: VehicleSpec
  reading: LiveReading
  /** 이 탈것의 아직 해결되지 않은 실측 문제 */
  open: readonly LiveIssueRecord[]
  /** 지표마다 이미 반영한 가장 새 측정 시각(해결한 문제 포함). 이보다 오래된 측정값으로는 새 문제를 열지 않습니다. */
  checkedAt?: Readonly<Record<string, number>>
  actions: readonly ActionRecord[]
  now: number
}

/**
 * 새 측정값으로 실측 문제를 열고, 등급을 올리고, 해결합니다. 반영한 문제마다 바뀐 기록을 돌려줍니다.
 * 문제에 이미 반영한 측정값(checkedAt)보다 오래된 측정값은 건너뛰고, 측정값이 30초 넘게 끊겼다 돌아오면
 * 그 사이를 알 수 없으므로 해결 대기(CLEAR_HOLD)를 처음부터 다시 셉니다.
 */
export function evaluateLiveIssues({ vehicle, reading, open, checkedAt = {}, actions, now }: EvaluateInput): LiveIssueChange[] {
  const changes: LiveIssueChange[] = []
  for (const metric of vehicle.metrics) {
    const value = reading.metrics[metric.key]
    // 기준과 문제 설명(fault)이 있는 지표만 문제로 엽니다.
    if (!metric.fault || metric.warn === null || typeof value !== 'number') continue
    const state = metricState(metric, value)
    const issue = open.find((item) => item.metricKey === metric.key && item.resolvedAt === null)
    if (!issue) {
      // 겹친 요청에서 더 새 측정값이 이미 문제를 해결했다면, 늦게 온 이상값으로 다시 열지 않습니다.
      if (state === 'nominal' || reading.at <= (checkedAt[metric.key] ?? Number.NEGATIVE_INFINITY)) continue
      changes.push({
        previous: null,
        record: {
          id: liveIssueId(vehicle.id, metric.key, reading.at),
          vehicleId: vehicle.id,
          metricKey: metric.key,
          severity: state,
          detectedAt: reading.at,
          clearedAt: null,
          resolvedAt: null,
          checkedAt: reading.at,
        },
      })
      continue
    }
    if (reading.at <= issue.checkedAt) continue
    const checked = { ...issue, checkedAt: reading.at }
    if (state !== 'nominal') {
      changes.push({ previous: issue, record: { ...checked, severity: worse(issue.severity, state), clearedAt: null } })
      continue
    }
    const resumed = reading.at - issue.checkedAt > LIVE_READING_MAX_AGE
    const clearedAt = issue.clearedAt === null || resumed ? reading.at : issue.clearedAt
    const settled = reading.at - clearedAt >= CLEAR_HOLD
    const resolvedAt = settled && commandStage(lastCommand(issue.id, actions), now) !== 'awaiting' ? reading.at : null
    changes.push({ previous: issue, record: { ...checked, clearedAt, resolvedAt } })
  }
  return changes
}

/** 화면에 보낼 실측 문제. 상태는 명령과 차량 응답으로 정합니다. */
export function liveIssueView(record: LiveIssueRecord, metric: MetricSpec, actions: readonly ActionRecord[], now: number): Issue {
  const fault = metric.fault!
  const last = lastCommand(record.id, actions)
  const issue: Issue = {
    id: record.id,
    vehicleId: record.vehicleId,
    metricKey: record.metricKey,
    severity: record.severity,
    title: fault.title,
    detail: fault.detail,
    detectedAt: record.detectedAt,
    status: 'open',
    actions: [...fault.actions],
    source: 'live',
  }
  if (record.resolvedAt !== null) {
    issue.status = 'resolved'
    issue.resolvedAt = record.resolvedAt
    if (last?.ack?.result === 'applied' && last.ack.at <= record.resolvedAt) issue.resolvedBy = last.action
    return issue
  }
  const stage = commandStage(last, now)
  if (stage) {
    issue.status = 'resolving'
    issue.stage = stage
  }
  return issue
}

/** 실차 명령의 기록: 전송, 그리고 적용 완료·실패·응답 없음·적용 뒤 회복 안 됨 */
export function liveActionLog(action: ActionRecord, label: string, now: number, issue: LiveIssueRecord | undefined): ActionLogEntry[] {
  const base = { vehicleId: action.vehicleId, issueId: action.issueId, action: action.action }
  const entries: ActionLogEntry[] = [{ ...base, id: `${action.id}-sent`, at: action.sentAt, phase: 'sent', message: `${label} 명령 전송` }]
  const ack = action.ack
  if (ack?.result === 'applied') {
    entries.push({ ...base, id: `${action.id}-completed`, at: ack.at, phase: 'completed', message: `${label} 차량 적용 완료` })
    const deadline = ack.at + RECOVERY_TIMEOUT
    if (deadline <= now && issue && (issue.resolvedAt === null || issue.resolvedAt > deadline)) {
      entries.push({
        ...base,
        id: `${action.id}-unrecovered`,
        at: deadline,
        phase: 'failed',
        message: `${label} 적용 뒤 ${RECOVERY_TIMEOUT / 60_000}분이 지나도 기준을 넘어 다시 조치가 필요합니다`,
      })
    }
  } else if (ack?.result === 'failed') {
    entries.push({ ...base, id: `${action.id}-failed`, at: ack.at, phase: 'failed', message: `${label} 차량 적용 실패${ack.message ? ` — ${ack.message}` : ''}` })
  } else if (ack?.result === 'timeout' || (!ack && now - action.sentAt >= ACK_TIMEOUT)) {
    entries.push({
      ...base,
      id: `${action.id}-timeout`,
      at: action.sentAt + ACK_TIMEOUT,
      phase: 'failed',
      message: `${label} 명령에 ${ACK_TIMEOUT / 60_000}분 동안 차량 응답 없음`,
    })
  }
  return entries
}
