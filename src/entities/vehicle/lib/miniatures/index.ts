import type { VehicleModelId } from '@shared/api'
import { createDucatiPanigaleV4S } from './ducati-panigale-v4s'
import { createGenesisG80 } from './genesis-g80'
import { createLamborghiniAventador } from './lamborghini-aventador'
import { createStridaLT } from './strida-lt'
import type { Miniature } from './parts'

const builders: Record<VehicleModelId, (paintHex: string) => Miniature> = {
  'genesis-g80': createGenesisG80,
  'lamborghini-aventador': createLamborghiniAventador,
  'ducati-panigale-v4s': createDucatiPanigaleV4S,
  'strida-lt': createStridaLT,
}

export function createMiniature(modelId: VehicleModelId, paintHex: string): Miniature {
  return builders[modelId](paintHex)
}

/** 굴러간 거리(m)만큼 바퀴를 돌립니다. */
export function rollWheels(miniature: Miniature, distance: number) {
  for (const wheel of miniature.wheels) wheel.object.rotation.z -= distance / wheel.radius
}

export type { Miniature }
