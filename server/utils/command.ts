import { ACTIONS } from '../../src/shared/api/contract'
import type { VehicleSpec } from './fleet-specs'
import { capValue } from './sim/engine'
import { ACK_TIMEOUT } from './sim/live'
import type { ActionRecord } from './sim/types'

/**
 * 차량에 보내는 명령. 속도·출력 제한은 적용할 값을 함께 보냅니다. 출력 제한은 출력 비율과 함께,
 * 관제 화면이 '속도 제한 적용 중'으로 보여 줄 최고 속도(capValue)도 담아 차량과 화면이 같은 값을 씁니다.
 */
export function toCommand(vehicle: VehicleSpec, action: ActionRecord) {
  const parameters =
    action.action === 'speed-limit'
      ? { maxSpeedKmh: capValue(vehicle, 'speed-limit') }
      : action.action === 'power-limit'
        ? { powerRatio: 0.6, maxSpeedKmh: capValue(vehicle, 'power-limit') }
        : undefined
  return {
    id: action.id,
    issueId: action.issueId,
    action: action.action,
    label: ACTIONS[action.action].label,
    description: ACTIONS[action.action].description,
    sentAt: action.sentAt,
    expiresAt: action.sentAt + ACK_TIMEOUT,
    ...(parameters ? { parameters } : {}),
  }
}
