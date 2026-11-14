import { Group } from 'three'
import { box, carWheel, createMaterials, extrudeProfile, frontPlate, sillWithArches } from './parts'
import type { Materials, Miniature, Point2 } from './parts'

/**
 * 옆모습 윤곽으로 만드는 단순한 자동차 미니어처. 실제 3D 모델을 받기 전과 받지 못했을 때 보이는 모형이라,
 * 몸체·유리 온실·지붕·램프·바퀴만 실제 치수(m)로 둡니다. +x가 앞, +y가 위입니다.
 */
export interface SimpleCarShape {
  length: number
  /** 몸체 폭(m) */
  width: number
  wheelRadius: number
  wheelWidth: number
  /** 바퀴 중심의 z(좌우 바퀴 사이 반) */
  track: number
  /** 앞·뒤 바퀴 중심의 x */
  axles: readonly [number, number]
  /** 바닥선 높이(m) */
  sill: number
  /** 몸체 옆모습: 앞 아래에서 시작해 위로, 뒤로 돌아 뒤 아래까지(바닥선과 바퀴 자리는 자동) */
  body: readonly Point2[]
  /** 유리 온실 옆모습과 폭 */
  cabin: readonly Point2[]
  cabinWidth: number
  /** 지붕 옆모습(도장색) */
  roof?: readonly Point2[]
  /** 앞 그릴 정면 윤곽(z, y) */
  grille?: readonly Point2[]
  /** 앞·뒤 램프 높이(m)와 앞 램프 폭(z 방향 반) */
  lamps: { front: number; rear: number; width: number }
  rim: 'bright' | 'dark'
  spokes: number
  /** 몸체 장식(전용 부품) */
  extras?: (root: Group, materials: Materials) => void
}

export function createSimpleCar(shape: SimpleCarShape, paintHex: string): Miniature {
  const m = createMaterials(paintHex)
  const root = new Group()
  const [frontAxle, rearAxle] = shape.axles
  const arches = [frontAxle, rearAxle].map((x) => ({ x, y: shape.wheelRadius, radius: shape.wheelRadius + 0.05 }))
  const half = shape.length / 2
  const body: Point2[] = [...shape.body, ...sillWithArches(-(half - 0.12), half - 0.12, shape.sill, arches)]
  root.add(extrudeProfile(body, shape.width, m.paint, 0.07))
  root.add(extrudeProfile(shape.cabin, shape.cabinWidth, m.glass, 0.05))
  if (shape.roof) root.add(extrudeProfile(shape.roof, shape.cabinWidth - 0.03, m.paint, 0.03))
  if (shape.grille) root.add(frontPlate(shape.grille, 0.05, m.darkMetal, half - 0.01))

  for (const side of [1, -1] as const) {
    root.add(box([0.03, 0.04, shape.lamps.width], [half - 0.02, shape.lamps.front, side * (shape.width / 2 - shape.lamps.width / 2 - 0.05)], m.headlight))
    root.add(box([0.03, 0.05, shape.width * 0.32], [-half + 0.02, shape.lamps.rear, side * shape.width * 0.28], m.taillight))
  }
  shape.extras?.(root, m)

  const wheels: Miniature['wheels'] = []
  for (const x of shape.axles) {
    for (const side of [1, -1] as const) {
      const { group, spin } = carWheel({
        radius: shape.wheelRadius,
        width: shape.wheelWidth,
        spokes: shape.spokes,
        materials: m,
        rim: shape.rim,
        side,
        caliper: m.darkMetal,
      })
      group.position.set(x, shape.wheelRadius, side * shape.track)
      root.add(group)
      wheels.push({ object: spin, radius: shape.wheelRadius })
    }
  }
  return { root, wheels, leanPivot: null, length: shape.length }
}
