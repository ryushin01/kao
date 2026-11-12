import {
  CapsuleGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Shape,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three'
import type { Material } from 'three'
import { createMaterials, tube } from './parts'
import type { Miniature } from './parts'

/**
 * STRiDA LT 접이식 자전거 (실측 비율)
 * - 16인치 바퀴(지름 약 410mm), 축거 약 840mm, 핸들 높이 약 1,050mm
 * - 세 개의 알루미늄 관이 위 꼭짓점의 검은 볼 조인트에서 만나는 A자 프레임
 * - 바퀴를 한쪽에서만 잡는 외팔 축: 앞바퀴는 왼쪽, 뒷바퀴는 오른쪽(벨트 쪽)
 * - 아래 관은 앞 관에 볼 소켓으로 붙어 접힐 때 빠지고, 크랭크는 아래 관 앞쪽에 달립니다
 * - 체인 대신 고무 벨트, 앞뒤 디스크 브레이크, 접이식 핸들, 뒤 짐받이 겸 받침대
 */
export function createStridaLT(paintHex: string): Miniature {
  const m = createMaterials(paintHex)
  const plastic = new MeshStandardMaterial({ color: '#141416', roughness: 0.55, metalness: 0.05 })
  const frameMaterial = new MeshStandardMaterial({ color: paintHex, metalness: 0.75, roughness: 0.28 })
  const fenderMaterial = new MeshStandardMaterial({ color: '#111113', roughness: 0.45, side: DoubleSide })

  const root = new Group()
  const leanPivot = new Group()
  root.add(leanPivot)
  const add = (...objects: Parameters<Group['add']>) => leanPivot.add(...objects)

  const radius = 0.205
  const hubOffset = 0.062
  const front = new Vector3(0.43, radius, 0)
  const rear = new Vector3(-0.41, radius, 0)
  const apex = new Vector3(0.05, 0.98, 0)

  const along = (from: Vector3, to: Vector3, distance: number) =>
    from.clone().add(to.clone().sub(from).normalize().multiplyScalar(distance))
  const sideways = (point: Vector3, z: number) => new Vector3(point.x, point.y, z)

  /** 점들을 매끈하게 잇는 둥근 관 */
  const smoothTube = (points: Vector3[], tubeRadius: number, material: Material, segments = 64) => {
    const curve = new CatmullRomCurve3(points, false, 'centripetal')
    const mesh = new Mesh(new TubeGeometry(curve, segments, tubeRadius, 18, false), material)
    mesh.castShadow = true
    return mesh
  }
  const ball = (point: Vector3, size: number, material: Material = plastic) => {
    const mesh = new Mesh(new SphereGeometry(size, 24, 16), material)
    mesh.position.copy(point)
    mesh.castShadow = true
    return mesh
  }

  // ── 프레임: 바퀴 반지름 안쪽으로 들어가기 전에 옆으로 비켜 축에 닿습니다.
  const frontSide = hubOffset
  const rearSide = -hubOffset
  add(
    smoothTube(
      [apex, along(front, apex, 0.42), along(front, apex, 0.28), sideways(along(front, apex, 0.2), frontSide * 0.85), sideways(front, frontSide)],
      0.019,
      frameMaterial,
    ),
  )
  add(
    smoothTube(
      [apex, along(rear, apex, 0.45), along(rear, apex, 0.3), sideways(along(rear, apex, 0.21), rearSide * 0.85), sideways(rear, rearSide)],
      0.019,
      frameMaterial,
    ),
  )
  const socket = along(front, apex, 0.265)
  add(
    smoothTube(
      [socket, socket.clone().lerp(rear, 0.35), sideways(socket.clone().lerp(rear, 0.72), rearSide * 0.5), sideways(along(rear, socket, 0.18), rearSide * 0.9), sideways(rear, rearSide)],
      0.017,
      frameMaterial,
    ),
  )
  // 볼 조인트(위 꼭짓점)와 볼 소켓(아래 관이 앞 관에 붙는 자리), 축 끝 마개
  add(ball(apex, 0.034))
  add(ball(socket, 0.026))
  add(ball(sideways(front, frontSide + 0.012), 0.022))
  add(ball(sideways(rear, rearSide - 0.012), 0.024))

  // ── 안장: 위에서 본 안장 모양을 둥글게 깎아 안장 관에 끼웁니다.
  const seatPoint = rear.clone().lerp(apex, 0.71)
  const saddleShape = new Shape()
  saddleShape.moveTo(0.13, 0)
  saddleShape.bezierCurveTo(0.13, 0.03, 0.06, 0.035, 0.01, 0.045)
  saddleShape.bezierCurveTo(-0.06, 0.09, -0.13, 0.085, -0.13, 0)
  saddleShape.bezierCurveTo(-0.13, -0.085, -0.06, -0.09, 0.01, -0.045)
  saddleShape.bezierCurveTo(0.06, -0.035, 0.13, -0.03, 0.13, 0)
  const saddleGeometry = new ExtrudeGeometry(saddleShape, {
    depth: 0.02,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.014,
    bevelSegments: 6,
    curveSegments: 24,
  })
  saddleGeometry.rotateX(-Math.PI / 2)
  const saddle = new Mesh(saddleGeometry, plastic)
  saddle.position.set(seatPoint.x - 0.015, seatPoint.y + 0.075, 0)
  saddle.castShadow = true
  add(saddle)
  add(tube([seatPoint.x, seatPoint.y + 0.065, 0], [seatPoint.x + 0.01, seatPoint.y - 0.01, 0], 0.012, m.darkMetal))
  const clamp = new Mesh(new CylinderGeometry(0.026, 0.026, 0.05, 20), plastic)
  clamp.position.copy(seatPoint)
  clamp.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), apex.clone().sub(rear).normalize())
  add(clamp)

  // ── 핸들: 꼭짓점 위 짧은 스템, 뒤로 살짝 휜 접이식 바, 그립, 브레이크 레버, 벨
  const stemTop = new Vector3(apex.x + 0.035, apex.y + 0.055, 0)
  add(tube([apex.x, apex.y, 0], [stemTop.x, stemTop.y, 0], 0.016, plastic))
  add(
    smoothTube(
      [
        new Vector3(stemTop.x - 0.05, stemTop.y + 0.012, 0.29),
        new Vector3(stemTop.x - 0.01, stemTop.y + 0.004, 0.16),
        new Vector3(stemTop.x, stemTop.y, 0),
        new Vector3(stemTop.x - 0.01, stemTop.y + 0.004, -0.16),
        new Vector3(stemTop.x - 0.05, stemTop.y + 0.012, -0.29),
      ],
      0.011,
      m.chrome,
    ),
  )
  add(ball(stemTop, 0.022))
  for (const side of [1, -1] as const) {
    const grip = new Mesh(new CapsuleGeometry(0.017, 0.08, 6, 16), m.rubber)
    grip.rotation.x = Math.PI / 2
    grip.position.set(stemTop.x - 0.048, stemTop.y + 0.012, side * 0.255)
    add(grip)
    add(tube([stemTop.x - 0.03, stemTop.y + 0.01, side * 0.19], [stemTop.x + 0.06, stemTop.y - 0.02, side * 0.23], 0.006, plastic, 8))
  }
  const bell = new Mesh(new SphereGeometry(0.018, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.chrome)
  bell.position.set(stemTop.x + 0.005, stemTop.y + 0.012, 0.09)
  add(bell)

  // ── 벨트 구동(오른쪽): 아래 관 앞쪽의 크랭크 풀리 → 뒤 허브 풀리
  const crank = socket.clone().lerp(rear, 0.3)
  const beltZ = rearSide - 0.012
  const pulley = (center: Vector3, size: number) => {
    const group = new Group()
    const body = new Mesh(new CylinderGeometry(size, size, 0.014, 40), m.darkMetal)
    body.rotation.x = Math.PI / 2
    group.add(body)
    const guard = new Mesh(new CylinderGeometry(size * 1.08, size * 1.08, 0.004, 40), plastic)
    guard.rotation.x = Math.PI / 2
    guard.position.z = -0.01
    group.add(guard)
    group.position.set(center.x, center.y, beltZ)
    return group
  }
  add(pulley(crank, 0.088))
  add(pulley(rear, 0.044))
  const beltMaterial = new MeshStandardMaterial({ color: '#1b1b1d', roughness: 0.7 })
  for (const sign of [1, -1]) {
    add(
      tube(
        [crank.x, crank.y + sign * 0.09, beltZ],
        [rear.x, rear.y + sign * 0.046, beltZ],
        0.005,
        beltMaterial,
        8,
      ),
    )
  }
  // 크랭크와 접이식 페달(양쪽 반대 방향)
  for (const side of [1, -1] as const) {
    const angle = side === 1 ? -0.35 : Math.PI - 0.35
    const end = new Vector3(crank.x + Math.cos(angle) * 0.145, crank.y + Math.sin(angle) * 0.145, side * 0.085)
    add(tube([crank.x, crank.y, side * 0.07], [end.x, end.y, end.z], 0.009, m.chrome, 10))
    const pedal = new Mesh(new CapsuleGeometry(0.014, 0.07, 4, 10), plastic)
    pedal.rotation.x = Math.PI / 2
    pedal.position.set(end.x, end.y, end.z + side * 0.045)
    add(pedal)
  }
  const axle = new Mesh(new CylinderGeometry(0.01, 0.01, 0.15, 12), m.darkMetal)
  axle.rotation.x = Math.PI / 2
  axle.position.set(crank.x, crank.y, 0)
  add(axle)

  // ── 흙받이와 뒤 짐받이(접었을 때 받침대)
  const fender = (center: Vector3, start: number, length: number) => {
    const mesh = new Mesh(new CylinderGeometry(radius + 0.03, radius + 0.03, 0.05, 48, 1, true, start, length), fenderMaterial)
    mesh.rotation.x = Math.PI / 2
    mesh.position.copy(center)
    return mesh
  }
  // 각도 기준: π가 바퀴 맨 위, π/2가 앞, 3π/2가 뒤
  add(fender(front, Math.PI * 0.62, Math.PI * 0.7))
  add(fender(rear, Math.PI * 0.92, Math.PI * 0.72))
  const rackTop = rear.y + radius + 0.06
  for (const side of [1, -1] as const) {
    add(
      smoothTube(
        [
          new Vector3(rear.x + 0.12, rackTop - 0.03, side * 0.05),
          new Vector3(rear.x - 0.02, rackTop, side * 0.06),
          new Vector3(rear.x - 0.2, rackTop - 0.01, side * 0.06),
          new Vector3(rear.x - 0.24, rackTop - 0.08, side * 0.05),
        ],
        0.006,
        plastic,
        24,
      ),
    )
  }
  const reflector = new Mesh(new CapsuleGeometry(0.012, 0.04, 4, 10), m.taillight)
  reflector.rotation.x = Math.PI / 2
  reflector.position.set(rear.x - 0.235, rackTop - 0.05, 0)
  add(reflector)

  // ── 바퀴: 둥근 타이어, 상자 단면 림, 한쪽 플랜지에서 뻗는 스포크, 디스크 브레이크
  const wheel = (axleSide: number) => {
    const spin = new Group()
    const tireProfile = [] as Vector2[]
    const tireRadius = 0.021
    for (let i = 0; i <= 24; i += 1) {
      const angle = -Math.PI / 2 + (i / 24) * Math.PI * 2
      tireProfile.push(new Vector2(radius - tireRadius + Math.cos(angle) * tireRadius, Math.sin(angle) * tireRadius * 1.05))
    }
    const tire = new Mesh(new LatheGeometry(tireProfile, 72), m.rubber)
    tire.rotation.x = Math.PI / 2
    tire.castShadow = true
    spin.add(tire)
    const rimRadius = radius - tireRadius * 2 - 0.008
    spin.add(new Mesh(new TorusGeometry(rimRadius, 0.008, 10, 72), m.chrome))
    const hub = new Mesh(new CylinderGeometry(0.018, 0.018, 0.07, 20), m.darkMetal)
    hub.rotation.x = Math.PI / 2
    hub.position.z = axleSide * 0.02
    spin.add(hub)
    for (let i = 0; i < 20; i += 1) {
      const angle = (i / 20) * Math.PI * 2
      const flange = (i % 2 === 0 ? 1 : -1) * 0.022
      spin.add(
        tube(
          [Math.cos(angle) * 0.02, Math.sin(angle) * 0.02, flange],
          [Math.cos(angle + 0.25) * rimRadius, Math.sin(angle + 0.25) * rimRadius, 0],
          0.0016,
          m.chrome,
          5,
        ),
      )
    }
    const rotor = new Mesh(new TorusGeometry(0.052, 0.012, 4, 40), m.chrome)
    rotor.scale.z = 0.25
    rotor.position.z = -axleSide * 0.03
    spin.add(rotor)
    return spin
  }

  const wheels: Miniature['wheels'] = []
  for (const [center, axleSide] of [
    [front, 1],
    [rear, -1],
  ] as const) {
    const spin = wheel(axleSide)
    spin.position.copy(center)
    add(spin)
    wheels.push({ object: spin, radius })
    // 고정된 캘리퍼(돌지 않음)
    const caliper = new Mesh(new CapsuleGeometry(0.012, 0.03, 4, 10), plastic)
    caliper.position.set(center.x + 0.035, center.y + 0.045, -axleSide * 0.04)
    caliper.rotation.z = -0.8
    add(caliper)
  }

  return { root, wheels, leanPivot, length: 1.14 }
}
