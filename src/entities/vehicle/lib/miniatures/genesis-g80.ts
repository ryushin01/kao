import { Group } from 'three'
import { box, carWheel, createMaterials, extrudeProfile, frontPlate, sillWithArches } from './parts'
import type { Miniature, Point2 } from './parts'

/**
 * Genesis G80 (3세대, RG3)
 * 전장 4,995 · 전폭 1,925 · 전고 1,465 · 축거 3,010mm
 * 긴 보닛과 패스트백 지붕선, 크레스트 그릴, 두 줄 쿼드 램프가 특징입니다.
 */
export function createGenesisG80(paintHex: string): Miniature {
  const m = createMaterials(paintHex)
  const root = new Group()
  const wheelRadius = 0.345
  const front = { x: 1.62, y: wheelRadius, radius: 0.4 }
  const rear = { x: -1.39, y: wheelRadius, radius: 0.4 }

  const body: Point2[] = [
    [2.42, 0.2],
    [2.5, 0.34],
    [2.51, 0.52],
    [2.46, 0.7],
    [2.2, 0.82],
    [1.7, 0.91],
    [1.15, 0.97],
    [0, 1.0],
    [-1.3, 1.02],
    [-2.28, 1.03],
    [-2.43, 1.0],
    [-2.5, 0.84],
    [-2.5, 0.48],
    [-2.42, 0.22],
    ...sillWithArches(-2.3, 2.3, 0.22, [front, rear]),
  ]
  root.add(extrudeProfile(body, 1.925, m.paint, 0.07))

  // 유리 온실: 몸체보다 좁게(텀블홈) 올립니다.
  const cabin: Point2[] = [
    [1.2, 0.96],
    [0.32, 1.42],
    [0.05, 1.46],
    [-0.75, 1.455],
    [-1.08, 1.41],
    [-1.8, 1.02],
    [-1.8, 0.96],
  ]
  root.add(extrudeProfile(cabin, 1.5, m.glass, 0.05))
  const roof: Point2[] = [
    [0.36, 1.415],
    [0.05, 1.47],
    [-0.75, 1.465],
    [-1.06, 1.42],
    [-1.02, 1.39],
    [0.3, 1.39],
  ]
  root.add(extrudeProfile(roof, 1.47, m.paint, 0.03))
  // B필러와 크롬 창틀
  root.add(box([0.06, 0.38, 1.46], [-0.32, 1.2, 0], m.trim))
  root.add(box([2.6, 0.018, 1.53], [-0.3, 1.0, 0], m.chrome))

  // 크레스트 그릴(방패 모양)
  const crest: Point2[] = [
    [0.44, 0.73],
    [0.4, 0.5],
    [0, 0.25],
    [-0.4, 0.5],
    [-0.44, 0.73],
  ]
  root.add(frontPlate(crest, 0.05, m.chrome, 2.5))
  const crestInner: Point2[] = crest.map(([z, y]) => [z * 0.9, 0.025 + y * 0.96])
  root.add(frontPlate(crestInner, 0.05, m.darkMetal, 2.515))

  // 두 줄 쿼드 램프(앞): 위아래 두 줄이 옆으로 감깁니다.
  for (const side of [1, -1] as const) {
    for (const y of [0.72, 0.655]) {
      root.add(box([0.03, 0.022, 0.36], [2.47, y, side * 0.72], m.headlight))
      root.add(box([0.32, 0.022, 0.03], [2.32, y + 0.01, side * 0.95], m.headlight, [0, side * 0.12, 0]))
    }
    // 두 줄 쿼드 램프(뒤)
    for (const y of [0.88, 0.82]) {
      root.add(box([0.03, 0.02, 0.52], [-2.515, y, side * 0.62], m.taillight))
      root.add(box([0.26, 0.02, 0.03], [-2.38, y, side * 0.955], m.taillight))
    }
    // 사이드미러
    root.add(box([0.16, 0.1, 0.18], [1.02, 1.06, side * 1.02], m.paint))
  }
  // 아래쪽 공기 흡입구와 뒤 범퍼 디퓨저
  root.add(box([0.04, 0.1, 1.5], [2.47, 0.27, 0], m.trim))
  root.add(box([0.06, 0.12, 1.4], [-2.48, 0.3, 0], m.trim))

  const wheels: Miniature['wheels'] = []
  for (const axle of [front, rear]) {
    for (const side of [1, -1] as const) {
      const { group, spin } = carWheel({
        radius: wheelRadius,
        width: 0.25,
        spokes: 20,
        materials: m,
        side,
        caliper: m.darkMetal,
      })
      group.position.set(axle.x, wheelRadius, side * 0.81)
      root.add(group)
      wheels.push({ object: spin, radius: wheelRadius })
    }
  }

  return { root, wheels, leanPivot: null, length: 4.995 }
}
