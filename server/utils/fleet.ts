import { createFleetEngine } from './fleet-engine'
import type { FleetEngine } from './fleet-engine'

let engine: FleetEngine | undefined

/** 서버 프로세스 하나에 시뮬레이션 하나를 둡니다. 요청이 올 때 지난 시간만큼 진행합니다. */
export function useFleetEngine(): FleetEngine {
  engine ??= createFleetEngine({
    seed: Date.now() % 100_000,
    initialFaults: [
      ['kao-0001', 'tire-fl'],
      ['kao-0003', 'coolant'],
    ],
  })
  engine.tick(Date.now())
  return engine
}
