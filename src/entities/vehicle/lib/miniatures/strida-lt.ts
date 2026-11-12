import { Group, Mesh, SphereGeometry, TorusGeometry } from 'three'
import { bikeWheel, box, createMaterials, disc, tube } from './parts'
import type { Miniature, Point3 } from './parts'

/**
 * STRiDA LT 접이식 자전거
 * 16인치 바퀴, 세 개의 관이 꼭짓점에서 만나는 A자 삼각 프레임, 체인 대신 고무 벨트 구동이 특징입니다.
 */
export function createStridaLT(paintHex: string): Miniature {
  const m = createMaterials(paintHex)
  const root = new Group()
  const leanPivot = new Group()
  root.add(leanPivot)
  const add = (...objects: Parameters<Group['add']>) => leanPivot.add(...objects)

  const radius = 0.2025
  const frontAxle: Point3 = [0.42, radius, 0]
  const rearAxle: Point3 = [-0.4, radius, 0]
  const apex: Point3 = [0.02, 1.0, 0]
  const lerp = (a: Point3, b: Point3, t: number): Point3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ]

  // A자 프레임: 앞 관, 뒤(안장) 관, 아래 관
  const lowerJoint = lerp(frontAxle, apex, 0.22)
  add(tube(frontAxle, apex, 0.022, m.paint))
  add(tube(rearAxle, apex, 0.022, m.paint))
  add(tube(lowerJoint, rearAxle, 0.02, m.paint))
  const joint = new Mesh(new SphereGeometry(0.04, 16, 12), m.trim)
  joint.position.set(...apex)
  add(joint)

  // 안장과 핸들바(접이식 T바)
  const seatPoint = lerp(rearAxle, apex, 0.74)
  add(box([0.26, 0.05, 0.15], [seatPoint[0] - 0.03, seatPoint[1] + 0.06, 0], m.trim))
  add(tube([apex[0], apex[1], 0], [apex[0] + 0.05, apex[1] + 0.04, 0], 0.02, m.trim))
  add(tube([apex[0] + 0.05, apex[1] + 0.04, -0.25], [apex[0] + 0.05, apex[1] + 0.04, 0.25], 0.012, m.trim))
  for (const s of [1, -1] as const) {
    add(tube([apex[0] + 0.05, apex[1] + 0.04, s * 0.17], [apex[0] + 0.05, apex[1] + 0.04, s * 0.26], 0.018, m.rubber))
  }

  // 벨트 구동: 앞쪽 크랭크 풀리 → 뒤 허브 풀리
  const crank = lerp(lowerJoint, rearAxle, 0.2)
  const pulley = disc(0.085, 0.012, m.trim)
  pulley.position.set(crank[0], crank[1], -0.05)
  add(pulley)
  const hubPulley = disc(0.045, 0.012, m.trim)
  hubPulley.position.set(rearAxle[0], rearAxle[1], -0.05)
  add(hubPulley)
  add(tube([crank[0], crank[1] + 0.083, -0.05], [rearAxle[0], rearAxle[1] + 0.045, -0.05], 0.006, m.rubber, 6))
  add(tube([crank[0], crank[1] - 0.083, -0.05], [rearAxle[0], rearAxle[1] - 0.045, -0.05], 0.006, m.rubber, 6))
  for (const s of [1, -1] as const) {
    const pedalEnd: Point3 = [crank[0] + s * 0.06, crank[1] - s * 0.15, s * 0.11]
    add(tube([crank[0], crank[1], s * 0.06], pedalEnd, 0.01, m.chrome))
    add(box([0.08, 0.02, 0.07], [pedalEnd[0], pedalEnd[1], pedalEnd[2] + s * 0.03], m.trim))
  }

  // 흙받이
  for (const axle of [frontAxle, rearAxle]) {
    const guard = new Mesh(new TorusGeometry(radius + 0.035, 0.012, 6, 24, Math.PI * 0.55), m.trim)
    guard.position.set(...axle)
    guard.rotation.z = axle === frontAxle ? Math.PI * 0.2 : Math.PI * 0.32
    add(guard)
  }

  const wheels: Miniature['wheels'] = []
  for (const axle of [frontAxle, rearAxle]) {
    const wheel = bikeWheel({ radius, tire: 0.038, spokes: 5, materials: m, rimMaterial: m.trim })
    wheel.position.set(...axle)
    add(wheel)
    wheels.push({ object: wheel, radius })
  }

  return { root, wheels, leanPivot, length: 1.14 }
}
