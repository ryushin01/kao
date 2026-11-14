import type { ActionCode, Severity } from '../../../src/shared/api/contract'

/** 차량이 실차 명령에 보낸 응답. timeout은 응답 시간이 지나 서버가 닫은 명령입니다. */
export type AckResult = 'applied' | 'failed' | 'timeout'

export interface CommandAck {
  at: number
  result: AckResult
  message: string | null
}

export interface ActionRecord {
  id: string
  issueId: string
  vehicleId: string
  action: ActionCode
  sentAt: number
  /** 실차 명령: 차량이 받아 간 시각(시뮬레이션 조치는 없음) */
  deliveredAt?: number | null
  /** 실차 명령: 차량의 응답(시뮬레이션 조치는 없음) */
  ack?: CommandAck | null
}

/** 실차 GPS 위치 */
export interface LivePosition {
  lat: number
  lng: number
  /** 경로 위 위치(0 이상 1 미만). 경로에서 벗어나 있으면 null */
  progress: number | null
  /**
   * 매시 정각부터 경로를 따라 간 거리(바퀴 단위, 출발 위치 포함). 앞뒤 측정값의 차이를 이어 붙여 구하므로
   * 출발선 근처에서 GPS가 흔들려도 바퀴 수가 늘었다 줄었다 할 뿐 쌓이지 않습니다.
   */
  odometer: number
}

/** 실제 차량에서 들어온 측정값 */
export interface LiveReading {
  vehicleId: string
  at: number
  speed?: number
  metrics: Record<string, number>
  position?: LivePosition
}

/** 실측값이 기준을 넘어 연 문제 */
export interface LiveIssueRecord {
  id: string
  vehicleId: string
  metricKey: string
  /** 지금까지 가장 나빴던 등급(내려가지 않습니다) */
  severity: Severity
  detectedAt: number
  /** 지표가 기준 안으로 돌아온 시각. 다시 넘으면 null */
  clearedAt: number | null
  resolvedAt: number | null
  /** 이 문제에 마지막으로 반영한 측정 시각. 이보다 오래된 측정값은 판단에 쓰지 않고, 저장할 때 동시 변경을 가리는 데도 씁니다. */
  checkedAt: number
}
