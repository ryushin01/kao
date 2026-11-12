import { Group, Mesh, TorusGeometry } from 'three'
import { bikeWheel, box, createMaterials, extrudeProfile, tube } from './parts'
import type { Miniature, Point2 } from './parts'

/**
 * Ducati Panigale V4 S
 * 전장 2,110 · 시트고 850 · 축거 1,469mm, 17인치 단조 휠
 * 뾰족한 노즈와 가는 주간주행등, 금색 Öhlins 포크, 한쪽 스윙암, 옆 윙렛이 특징입니다.
 */
export function createDucatiPanigaleV4S(paintHex: string): Miniature {
  const m = createMaterials(paintHex)
  const root = new Group()
  // 기울기는 바닥 접지선(앞뒤 바퀴를 잇는 선)을 축으로 돌립니다.
  const leanPivot = new Group()
  root.add(leanPivot)
  const add = (...objects: Parameters<Group['add']>) => leanPivot.add(...objects)

  const frontAxle = { x: 0.74, y: 0.3 }
  const rearAxle = { x: -0.73, y: 0.335 }

  // 앞 노즈 페어링(앞바퀴 위)
  const nose: Point2[] = [
    [1.04, 0.84],
    [0.99, 0.95],
    [0.82, 1.01],
    [0.55, 1.0],
    [0.4, 0.9],
    [0.38, 0.7],
    [0.55, 0.66],
    [0.8, 0.68],
    [0.97, 0.75],
  ]
  add(extrudeProfile(nose, 0.4, m.paint, 0.05))
  // 옆 페어링(엔진 옆과 아래)
  const side: Point2[] = [
    [0.42, 0.88],
    [0.37, 0.55],
    [0.3, 0.2],
    [-0.12, 0.17],
    [-0.2, 0.32],
    [-0.04, 0.5],
    [0.06, 0.78],
    [0.2, 0.9],
  ]
  add(extrudeProfile(side, 0.34, m.paint, 0.05))
  // 연료 탱크
  const tank: Point2[] = [
    [0.44, 0.97],
    [0.2, 1.06],
    [-0.05, 1.03],
    [-0.21, 0.92],
    [-0.15, 0.8],
    [0.3, 0.82],
  ]
  add(extrudeProfile(tank, 0.36, m.paint, 0.06))
  // 시트와 꼬리
  const seat: Point2[] = [
    [-0.18, 0.9],
    [-0.56, 0.88],
    [-0.56, 0.83],
    [-0.18, 0.83],
  ]
  add(extrudeProfile(seat, 0.26, m.trim, 0.025))
  const tail: Point2[] = [
    [-0.5, 0.86],
    [-0.9, 0.98],
    [-1.06, 1.01],
    [-1.03, 0.95],
    [-0.72, 0.8],
    [-0.4, 0.76],
  ]
  add(extrudeProfile(tail, 0.22, m.paint, 0.04))
  add(box([0.02, 0.025, 0.14], [-1.06, 0.98, 0], m.taillight))
  // 짙은 윈드스크린
  const screen: Point2[] = [
    [0.97, 0.95],
    [0.64, 1.14],
    [0.56, 1.03],
    [0.82, 1.0],
  ]
  add(extrudeProfile(screen, 0.3, m.smoked, 0.02))

  // 엔진(V4)과 프레임
  add(box([0.48, 0.34, 0.3], [0.06, 0.42, 0], m.darkMetal))
  add(box([0.2, 0.18, 0.34], [0.2, 0.66, 0], m.darkMetal, [0, 0, 0.5]))
  add(tube([0.5, 0.94, 0], [-0.08, 0.68, 0], 0.035, m.darkMetal))

  for (const s of [1, -1] as const) {
    // 가는 주간주행등
    add(box([0.16, 0.018, 0.02], [0.98, 0.86, s * 0.1], m.headlight, [0, s * 0.35, -0.2]))
    // 윙렛과 미러
    add(box([0.22, 0.015, 0.1], [0.55, 0.76, s * 0.25], m.trim, [0.15 * s, 0, -0.08]))
    add(box([0.1, 0.05, 0.08], [0.78, 1.0, s * 0.23], m.trim))
    // 금색 Öhlins 포크(아래)와 검은 포크(위), 클립온 핸들
    add(tube([frontAxle.x, frontAxle.y, s * 0.1], [0.62, 0.62, s * 0.1], 0.03, m.gold))
    add(tube([0.62, 0.62, s * 0.1], [0.5, 0.93, s * 0.1], 0.027, m.darkMetal))
    add(tube([0.48, 0.92, s * 0.11], [0.43, 0.91, s * 0.33], 0.014, m.trim))
    // 발판
    add(box([0.08, 0.02, 0.04], [-0.32, 0.4, s * 0.2], m.chrome))
  }
  add(box([0.12, 0.03, 0.26], [0.5, 0.95, 0], m.darkMetal))

  // 한쪽 스윙암(오른쪽)과 배기
  add(tube([-0.1, 0.42, -0.13], [rearAxle.x, rearAxle.y, -0.13], 0.045, m.darkRim))
  add(tube([-0.05, 0.22, -0.11], [-0.32, 0.22, -0.13], 0.05, m.darkMetal))
  add(tube([-0.32, 0.22, -0.13], [-0.4, 0.23, -0.13], 0.035, m.chrome))

  // 앞 펜더
  const fender = new Mesh(new TorusGeometry(0.33, 0.025, 8, 24, Math.PI / 2.2), m.paint)
  fender.position.set(frontAxle.x, frontAxle.y, 0)
  fender.rotation.z = Math.PI * 0.18
  add(fender)

  const wheels: Miniature['wheels'] = []
  const frontWheel = bikeWheel({ radius: 0.3, tire: 0.12, spokes: 3, materials: m, rimMaterial: m.darkRim })
  frontWheel.position.set(frontAxle.x, frontAxle.y, 0)
  add(frontWheel)
  wheels.push({ object: frontWheel, radius: 0.3 })
  const rearWheel = bikeWheel({ radius: 0.335, tire: 0.19, spokes: 3, materials: m, rimMaterial: m.darkRim })
  rearWheel.position.set(rearAxle.x, rearAxle.y, 0)
  add(rearWheel)
  wheels.push({ object: rearWheel, radius: 0.335 })

  return { root, wheels, leanPivot, length: 2.11 }
}
