import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  TorusGeometry,
  Vector3,
} from 'three'
import type { Material, Object3D } from 'three'

export type Point2 = readonly [number, number]
export type Point3 = readonly [number, number, number]

/** 미니어처 한 대. 좌표는 실제 치수(m)이고 +x가 앞, +y가 위입니다. */
export interface Miniature {
  root: Group
  /** 굴러가는 바퀴와 반지름 */
  wheels: Array<{ object: Object3D; radius: number }>
  /** 이륜차의 기울기를 줄 노드(없으면 기울지 않음) */
  leanPivot: Object3D | null
  length: number
}

export function createMaterials(paintHex: string) {
  return {
    paint: new MeshPhysicalMaterial({
      color: paintHex,
      metalness: 0.55,
      roughness: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
    }),
    glass: new MeshPhysicalMaterial({ color: '#06080b', metalness: 0.3, roughness: 0.04, clearcoat: 1 }),
    smoked: new MeshPhysicalMaterial({ color: '#15181c', metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.65 }),
    rubber: new MeshStandardMaterial({ color: '#0c0c0d', roughness: 0.92 }),
    rim: new MeshStandardMaterial({ color: '#c3c6cc', metalness: 1, roughness: 0.22 }),
    darkRim: new MeshStandardMaterial({ color: '#1f2023', metalness: 0.85, roughness: 0.35 }),
    darkMetal: new MeshStandardMaterial({ color: '#2b2c30', metalness: 0.8, roughness: 0.4 }),
    chrome: new MeshStandardMaterial({ color: '#e6e8eb', metalness: 1, roughness: 0.08 }),
    trim: new MeshStandardMaterial({ color: '#0a0a0b', roughness: 0.55 }),
    gold: new MeshStandardMaterial({ color: '#c99a2e', metalness: 1, roughness: 0.25 }),
    caliper: new MeshStandardMaterial({ color: '#b3121b', metalness: 0.4, roughness: 0.35 }),
    headlight: new MeshStandardMaterial({ color: '#ffffff', emissive: '#f4f7ff', emissiveIntensity: 2.4 }),
    taillight: new MeshStandardMaterial({ color: '#ff2a1a', emissive: '#ff1a0a', emissiveIntensity: 2.2 }),
  }
}

export type Materials = ReturnType<typeof createMaterials>

/**
 * 옆모습 윤곽(x, y)을 폭 방향(z)으로 밀어 낸 몸체를 만듭니다. z 중심이 0입니다.
 */
export function extrudeProfile(points: readonly Point2[], width: number, material: Material, bevel = 0.04): Mesh {
  const shape = new Shape()
  points.forEach(([x, y], index) => (index === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)))
  shape.closePath()
  const depth = Math.max(0.001, width - bevel * 2)
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 0.6,
    bevelSegments: 4,
    curveSegments: 16,
  })
  geometry.translate(0, 0, -depth / 2)
  geometry.computeVertexNormals()
  const mesh = new Mesh(geometry, material)
  mesh.castShadow = true
  return mesh
}

/** 정면(z, y) 윤곽을 앞뒤 방향(x)으로 얇게 밀어 낸 판입니다. 그릴·램프 같은 앞뒤 면 장식에 씁니다. */
export function frontPlate(points: readonly Point2[], depth: number, material: Material, x: number): Mesh {
  const shape = new Shape()
  points.forEach(([z, y], index) => (index === 0 ? shape.moveTo(z, y) : shape.lineTo(z, y)))
  shape.closePath()
  const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: false })
  geometry.translate(0, 0, -depth / 2)
  const mesh = new Mesh(geometry, material)
  mesh.rotation.y = Math.PI / 2
  mesh.position.x = x
  return mesh
}

/** 바퀴 자리를 둥글게 파낸 바닥선. from에서 to 방향으로 점을 냅니다. */
export function sillWithArches(
  from: number,
  to: number,
  sillY: number,
  arches: ReadonlyArray<{ x: number; y: number; radius: number }>,
  segments = 14,
): Point2[] {
  const forward = to > from
  const ordered = [...arches].sort((a, b) => (forward ? a.x - b.x : b.x - a.x))
  const points: Point2[] = [[from, sillY]]
  for (const arch of ordered) {
    const theta = Math.asin(Math.max(-1, Math.min(1, (sillY - arch.y) / arch.radius)))
    const start = forward ? Math.PI - theta : theta
    const end = forward ? theta : Math.PI - theta
    for (let i = 0; i <= segments; i += 1) {
      const angle = start + ((end - start) * i) / segments
      points.push([arch.x + Math.cos(angle) * arch.radius, arch.y + Math.sin(angle) * arch.radius])
    }
  }
  points.push([to, sillY])
  return points
}

export function box(size: Point3, position: Point3, material: Material, rotation: Point3 = [0, 0, 0]): Mesh {
  const mesh = new Mesh(new BoxGeometry(...size), material)
  mesh.position.set(...position)
  mesh.rotation.set(...rotation)
  mesh.castShadow = true
  return mesh
}

const UP = new Vector3(0, 1, 0)

/** 두 점을 잇는 원통(프레임, 포크, 핸들바) */
export function tube(from: Point3, to: Point3, radius: number, material: Material, radialSegments = 14): Mesh {
  const a = new Vector3(...from)
  const b = new Vector3(...to)
  const direction = b.clone().sub(a)
  const mesh = new Mesh(new CylinderGeometry(radius, radius, direction.length(), radialSegments), material)
  mesh.position.copy(a.add(b).multiplyScalar(0.5))
  mesh.quaternion.copy(new Quaternion().setFromUnitVectors(UP, direction.normalize()))
  mesh.castShadow = true
  return mesh
}

/** 축이 z 방향인 원판 */
export function disc(radius: number, thickness: number, material: Material, segments = 40): Mesh {
  const mesh = new Mesh(new CylinderGeometry(radius, radius, thickness, segments), material)
  mesh.rotation.x = Math.PI / 2
  return mesh
}

interface CarWheelOptions {
  radius: number
  width: number
  spokes: number
  materials: Materials
  rim?: 'bright' | 'dark'
  /** 바깥 면 방향(+1: +z쪽, -1: -z쪽) */
  side: 1 | -1
  caliper?: Material
}

/** 자동차 바퀴. 돌아가는 부분(spin)과 고정된 캘리퍼를 나눕니다. */
export function carWheel({ radius, width, spokes, materials, rim = 'bright', side, caliper }: CarWheelOptions) {
  const group = new Group()
  const spin = new Group()
  group.add(spin)
  const rimMaterial = rim === 'bright' ? materials.rim : materials.darkRim
  const rimRadius = radius * 0.7

  const tire = disc(radius, width, materials.rubber)
  tire.castShadow = true
  spin.add(tire)
  const sidewall = new Mesh(new TorusGeometry(radius - width * 0.18, width * 0.2, 10, 40), materials.rubber)
  sidewall.position.z = (side * width) / 2 - side * width * 0.06
  spin.add(sidewall)

  const face = side * (width / 2 + 0.004)
  const barrel = disc(rimRadius, width * 0.98, materials.darkMetal)
  spin.add(barrel)
  const lip = new Mesh(new TorusGeometry(rimRadius, 0.012, 8, 40), rimMaterial)
  lip.position.z = face
  spin.add(lip)
  for (let i = 0; i < spokes; i += 1) {
    const angle = (i / spokes) * Math.PI * 2
    const spoke = box([rimRadius * 0.95, rimRadius * (spokes > 12 ? 0.07 : 0.16), 0.03], [0, 0, 0], rimMaterial, [0, 0, angle])
    spoke.position.set(Math.cos(angle) * rimRadius * 0.48, Math.sin(angle) * rimRadius * 0.48, face - side * 0.012)
    spin.add(spoke)
  }
  const hub = disc(rimRadius * 0.2, 0.04, rimMaterial, 20)
  hub.position.z = face
  spin.add(hub)

  if (caliper) {
    const calipers = box([0.16, 0.07, 0.06], [radius * 0.38, radius * 0.38, side * (width / 2 - 0.06)], caliper, [0, 0, Math.PI / 4])
    group.add(calipers)
  }
  return { group, spin }
}

interface BikeWheelOptions {
  radius: number
  tire: number
  spokes: number
  materials: Materials
  rimMaterial: Material
  brakeDisc?: boolean
}

/** 이륜차 바퀴. 타이어는 둥근 고리 모양입니다. */
export function bikeWheel({ radius, tire, spokes, materials, rimMaterial, brakeDisc = true }: BikeWheelOptions) {
  const spin = new Group()
  spin.add(new Mesh(new TorusGeometry(radius - tire / 2, tire / 2, 14, 48), materials.rubber))
  const rimRadius = radius - tire
  spin.add(new Mesh(new TorusGeometry(rimRadius, tire * 0.18, 8, 48), rimMaterial))
  for (let i = 0; i < spokes; i += 1) {
    const angle = (i / spokes) * Math.PI * 2
    const spoke = box([rimRadius, tire * 0.35, tire * 0.25], [0, 0, 0], rimMaterial, [0, 0, angle])
    spoke.position.set(Math.cos(angle) * rimRadius * 0.5, Math.sin(angle) * rimRadius * 0.5, 0)
    spin.add(spoke)
  }
  const hub = disc(rimRadius * 0.16, tire * 1.1, materials.darkMetal, 18)
  spin.add(hub)
  if (brakeDisc) {
    const rotor = disc(rimRadius * 0.55, 0.006, materials.chrome, 32)
    rotor.position.z = tire * 0.45
    spin.add(rotor)
  }
  return spin
}
