/**
 * 서버(Nitro)와 화면이 함께 쓰는 관제 데이터 계약입니다.
 * 서버는 이 타입으로 프레임을 만들고, 화면은 같은 타입으로 읽습니다.
 */

export type VehicleKind = 'sedan' | 'supercar' | 'superbike' | 'bicycle'

export type VehicleModelId = 'genesis-g80' | 'lamborghini-aventador' | 'ducati-panigale-v4s' | 'strida-lt'

export type HealthState = 'nominal' | 'warning' | 'critical'

export type Severity = Exclude<HealthState, 'nominal'>

export type IssueStatus = 'open' | 'resolving' | 'resolved'

export type ActionCode =
  | 'cooling-mode'
  | 'power-limit'
  | 'speed-limit'
  | 'tpms-recalibrate'
  | 'notify-rider'
  | 'traction-boost'
  | 'eco-power'
  | 'dispatch-service'

export interface MetricReading {
  key: string
  label: string
  unit: string
  value: number
  min: number
  max: number
  /** 경고 기준값. 없으면 관찰만 하는 지표입니다. */
  warn: number | null
  /** 위험 기준값 */
  crit: number | null
  /** high: 기준값보다 높으면 문제, low: 낮으면 문제 */
  direction: 'high' | 'low'
  /** 소수점 자릿수 */
  precision: number
  state: HealthState
}

export interface Issue {
  id: string
  vehicleId: string
  metricKey: string
  severity: Severity
  title: string
  detail: string
  detectedAt: number
  status: IssueStatus
  actions: ActionCode[]
  resolvedBy?: ActionCode
  resolvedAt?: number
}

export interface VehicleSnapshot {
  id: string
  modelId: VehicleModelId
  kind: VehicleKind
  maker: string
  model: string
  year: number
  plate: string
  member: string
  paint: { name: string; hex: string }
  routeId: string
  /** live: 실제 차량에서 30초 안에 측정값이 들어옴, simulated: 시뮬레이션 */
  source: 'live' | 'simulated'
  /** 경로 위 위치(0 이상 1 미만) */
  progress: number
  lap: number
  speed: number
  /** 원격 조치로 걸린 속도 제한(km/h). 없으면 null */
  speedCap: number | null
  health: HealthState
  metrics: MetricReading[]
  issues: Issue[]
}

export interface ActionLogEntry {
  id: string
  vehicleId: string
  issueId: string
  action: ActionCode
  at: number
  phase: 'sent' | 'completed'
  message: string
}

export interface FleetFrame {
  at: number
  /** 위치 계산에 쓰는 시뮬레이션 배속 */
  timeScale: number
  vehicles: VehicleSnapshot[]
  log: ActionLogEntry[]
}

export interface RemoteActionRequest {
  issueId: string
  action: ActionCode
}

export interface RemoteActionResponse {
  entry: ActionLogEntry
  vehicle: VehicleSnapshot
}

export const ACTIONS: Record<ActionCode, { label: string; description: string }> = {
  'cooling-mode': { label: '냉각 모드', description: '냉각 팬과 펌프를 최대로 돌리고 엔진 회전수를 낮춥니다.' },
  'power-limit': { label: '출력 제한', description: 'ECU 출력 지도를 보호 모드로 바꿔 최고 출력을 60%로 묶습니다.' },
  'speed-limit': { label: '속도 제한', description: '최고 속도를 80km/h로 묶고 계기판에 안내를 띄웁니다.' },
  'tpms-recalibrate': { label: 'TPMS 재보정', description: '타이어 공기압 센서를 다시 맞춰 잘못된 경보를 걸러 냅니다.' },
  'notify-rider': { label: '운전자 알림', description: '계기판과 운전자 휴대폰으로 점검 안내를 보냅니다.' },
  'traction-boost': { label: '트랙션 강화', description: '트랙션·윌리 컨트롤 단계를 올려 미끄러짐을 줄입니다.' },
  'eco-power': { label: '절전 모드', description: '부가 장치 전원을 끊어 배터리 소모를 줄입니다.' },
  'dispatch-service': { label: '긴급 출동', description: '가장 가까운 협력 정비소에 현장 출동을 요청합니다.' },
}

export const HEALTH_LABELS: Record<HealthState, string> = {
  nominal: '정상',
  warning: '경고',
  critical: '위험',
}

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open: '조치 필요',
  resolving: '조치 중',
  resolved: '해결됨',
}

export type UserRole = 'operator' | 'member'

export interface SessionUser {
  id: string
  login: string
  name: string
  role: UserRole
  /** 볼 수 있는 탈것 id. 관제 요원은 전체 */
  vehicleIds: string[]
}

export interface SessionResponse {
  user: SessionUser | null
  /** 웹 푸시 공개 키(서버에 설정이 없으면 null) */
  pushPublicKey: string | null
}

export interface LoginRequest {
  login: string
  password: string
}

export interface HistoryResponse {
  vehicleId: string
  metric: MetricReading
  from: number
  to: number
  samples: Array<{ at: number; value: number }>
}

/** 로그인하지 않아도 보는 소개 화면용 요약 */
export interface ShowroomResponse {
  vehicles: Array<Pick<VehicleSnapshot, 'id' | 'modelId' | 'kind' | 'maker' | 'model' | 'paint' | 'speed' | 'metrics'>>
  summary: { vehicles: number; open: number }
}

/** 로그인 화면에 보여 주는 데모 계정(비밀번호는 모두 같음) */
export const DEMO_PASSWORD = 'kao-demo-2026'
export const DEMO_ACCOUNTS: Array<{ login: string; name: string; role: UserRole; vehicleIds: string[]; description: string }> = [
  { login: 'operator', name: '관제 요원', role: 'operator', vehicleIds: [], description: '4대 전체 관제와 원격 조치' },
  { login: 'member01', name: '가상 회원 01', role: 'member', vehicleIds: ['kao-0001'], description: 'Genesis G80' },
  { login: 'member02', name: '가상 회원 02', role: 'member', vehicleIds: ['kao-0002'], description: 'Lamborghini Aventador' },
  { login: 'member03', name: '가상 회원 03', role: 'member', vehicleIds: ['kao-0003'], description: 'Ducati Panigale V4 S' },
  { login: 'member04', name: '가상 회원 04', role: 'member', vehicleIds: ['kao-0004'], description: 'STRiDA LT' },
]
