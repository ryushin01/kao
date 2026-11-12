import { Group } from 'three'
import { box, carWheel, createMaterials, extrudeProfile, frontPlate, sillWithArches } from './parts'
import type { Miniature, Point2 } from './parts'

/**
 * Lamborghini Aventador LP 780-4 Ultimae
 * 전장 4,868 · 전폭 2,098 · 전고 1,136 · 축거 2,700mm
 * 한 줄로 이어지는 쐐기형 윤곽, Y자 램프, 옆구리의 큰 공기 흡입구, 육각 배기구가 특징입니다.
 */
export function createLamborghiniAventador(paintHex: string): Miniature {
  const m = createMaterials(paintHex)
  const root = new Group()
  const front = { x: 1.35, y: 0.33, radius: 0.38 }
  const rear = { x: -1.35, y: 0.355, radius: 0.41 }

  const body: Point2[] = [
    [2.36, 0.12],
    [2.45, 0.24],
    [2.44, 0.33],
    [2.05, 0.5],
    [1.4, 0.66],
    [0.95, 0.74],
    [0, 0.8],
    [-0.9, 0.86],
    [-1.6, 0.92],
    [-2.2, 0.95],
    [-2.43, 0.97],
    [-2.45, 0.7],
    [-2.4, 0.3],
    [-2.3, 0.12],
    ...sillWithArches(-2.2, 2.25, 0.12, [front, rear]),
  ]
  root.add(extrudeProfile(body, 2.06, m.paint, 0.06))

  // 캐빈 유리: 앞유리부터 지붕까지 한 번에 이어지는 쐐기
  const cabin: Point2[] = [
    [1.05, 0.72],
    [0.1, 1.12],
    [-0.45, 1.13],
    [-0.9, 1.07],
    [-0.9, 0.78],
  ]
  root.add(extrudeProfile(cabin, 1.42, m.glass, 0.05))
  const roof: Point2[] = [
    [0.15, 1.11],
    [-0.45, 1.136],
    [-0.88, 1.08],
    [-0.88, 1.06],
    [0.12, 1.08],
  ]
  root.add(extrudeProfile(roof, 1.36, m.paint, 0.02))

  // 엔진 덮개와 육각 루버
  const engineCover: Point2[] = [
    [-0.82, 1.07],
    [-1.95, 0.93],
    [-1.95, 0.82],
    [-0.82, 0.82],
  ]
  root.add(extrudeProfile(engineCover, 1.3, m.paint, 0.03))
  for (let i = 0; i < 6; i += 1) {
    const x = -1.0 - i * 0.16
    const y = 1.05 - i * 0.02 - (i * 0.16 * 0.12)
    root.add(box([0.06, 0.02, 1.0], [x, y + 0.015, 0], m.trim, [0, 0, 0.12]))
  }

  for (const side of [1, -1] as const) {
    // 옆구리 대형 공기 흡입구(문 뒤 삼각형)
    const intake: Point2[] = [
      [-0.25, 0.4],
      [-1.05, 0.8],
      [-1.05, 0.4],
    ]
    const intakeMesh = extrudeProfile(intake, 0.02, m.trim, 0)
    intakeMesh.position.z = side * 1.03
    root.add(intakeMesh)

    // Y자 주간주행등: 보닛 경사를 따라 눕힙니다.
    const lamp = new Group()
    lamp.add(box([0.22, 0.02, 0.025], [0, 0, 0], m.headlight, [0, 0.5, 0]))
    lamp.add(box([0.22, 0.02, 0.025], [0, 0, side * 0.1], m.headlight, [0, -0.5, 0]))
    lamp.add(box([0.16, 0.02, 0.025], [-0.17, 0, side * 0.05], m.headlight))
    lamp.position.set(2.12, 0.5, side * 0.72)
    lamp.rotation.z = -0.26
    root.add(lamp)

    // 앞 범퍼 흡입구
    root.add(box([0.05, 0.12, 0.55], [2.42, 0.2, side * 0.62], m.trim))
    // Y자 미등
    root.add(box([0.03, 0.025, 0.4], [-2.45, 0.8, side * 0.72], m.taillight, [0.5, 0, 0]))
    root.add(box([0.03, 0.025, 0.4], [-2.45, 0.8, side * 0.72], m.taillight, [-0.5, 0, 0]))
    // 고정 날개 지지대와 사이드미러
    root.add(box([0.12, 0.12, 0.03], [-2.22, 1.02, side * 0.55], m.trim))
    root.add(box([0.14, 0.08, 0.2], [0.85, 0.86, side * 1.05], m.paint))
  }

  // 뒤 날개, 디퓨저, 육각 배기구
  root.add(box([0.3, 0.025, 1.75], [-2.26, 1.09, 0], m.trim, [0, 0, -0.08]))
  root.add(box([0.25, 0.1, 1.6], [-2.35, 0.16, 0], m.trim))
  const exhaust: Point2[] = Array.from({ length: 6 }, (_, i) => {
    const angle = (i / 6) * Math.PI * 2
    return [Math.cos(angle) * 0.13, 0.42 + Math.sin(angle) * 0.13] as const
  })
  root.add(frontPlate(exhaust, 0.08, m.chrome, -2.46))
  root.add(frontPlate(exhaust.map(([z, y]) => [z * 0.7, 0.42 + (y - 0.42) * 0.7]), 0.08, m.trim, -2.475))

  const wheels: Miniature['wheels'] = []
  for (const [axle, track, width] of [
    [front, 0.9, 0.26],
    [rear, 0.88, 0.34],
  ] as const) {
    for (const side of [1, -1] as const) {
      const { group, spin } = carWheel({
        radius: axle.y,
        width,
        spokes: 10,
        materials: m,
        rim: 'dark',
        side,
        caliper: m.caliper,
      })
      group.position.set(axle.x, axle.y, side * track)
      root.add(group)
      wheels.push({ object: spin, radius: axle.y })
    }
  }

  return { root, wheels, leanPivot: null, length: 4.868 }
}
