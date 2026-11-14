import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, Path, Shape, ShapeGeometry, Vector2 } from 'three'

/**
 * 관제 지도의 서울 도심 바탕(도로·한강·공원). scripts/build-seoul-map.mjs가 OpenStreetMap으로 만든
 * public/maps/seoul.json을 받아, 지면에 붙은 평면 도형으로 그립니다. 지도 데이터 © OpenStreetMap 기여자(ODbL).
 */

export type RoadKind = 'minor' | 'cycleway' | 'tertiary' | 'link' | 'secondary' | 'primary' | 'trunk'

interface Polygon {
  /** [x0, z0, x1, z1, …] 지도 좌표(m) */
  outer: number[]
  holes: number[][]
}

export interface SeoulMapData {
  attribution: string
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  roads: Record<RoadKind, number[][]>
  water: Polygon[]
  parks: Polygon[]
}

export const SEOUL_MAP_URL = '/maps/seoul.json'

let request: Promise<SeoulMapData | null> | null = null

/** 지도 데이터는 한 번만 받습니다. 받지 못하면 null이고, 관제 지도는 바탕 없이 경로만 그립니다. */
export function loadSeoulMap() {
  request ??= fetch(SEOUL_MAP_URL)
    .then((response) => (response.ok ? (response.json() as Promise<SeoulMapData>) : null))
    .catch(() => null)
  return request
}

/** 도로 등급별 폭(m, 멀리서도 보이게 실제보다 넓게)과 색. 낮은 등급부터 그려 큰길이 위에 옵니다. */
const ROAD_STYLE: ReadonlyArray<readonly [RoadKind, number, string]> = [
  ['minor', 9, '#1a1617'],
  ['cycleway', 7, '#121d25'],
  ['tertiary', 16, '#272223'],
  ['link', 14, '#2e2829'],
  ['secondary', 22, '#353031'],
  ['primary', 30, '#423b3c'],
  ['trunk', 40, '#524849'],
]

/**
 * 선을 따라 폭이 일정한 띠(평면). 꺾이는 점에서는 앞뒤 선분의 법선을 평균 낸 방향(마이터)으로 벌려
 * 바깥선이 매끄럽게 이어지고, 열린 선은 양 끝을 반폭만큼 늘려 다른 길과 만나는 곳이 비지 않게 합니다.
 * lines는 [x0, z0, x1, z1, …](m)이고, unit(m)으로 나눠 장면 좌표로 바꿉니다. closed면 마지막 점이 첫 점으로 이어집니다.
 */
export function ribbon(lines: ReadonlyArray<ArrayLike<number>>, width: number, unit: number, closed = false) {
  const half = width / 2
  const polylines: Array<Array<[number, number]>> = []
  let vertexCount = 0
  let indexCount = 0
  for (const line of lines) {
    const points: Array<[number, number]> = []
    for (let i = 0; i + 1 < line.length; i += 2) {
      const x = line[i]!
      const z = line[i + 1]!
      const last = points.at(-1)
      if (!last || Math.hypot(last[0] - x, last[1] - z) > 0.01) points.push([x, z])
    }
    if (closed && points.length > 2 && Math.hypot(points[0]![0] - points.at(-1)![0], points[0]![1] - points.at(-1)![1]) < 0.01) points.pop()
    if (points.length < 2) continue
    polylines.push(points)
    vertexCount += points.length * 2 + (closed ? 2 : 0)
    indexCount += (points.length - 1 + (closed ? 1 : 0)) * 6
  }
  const positions = new Float32Array(vertexCount * 3)
  const index = new Uint32Array(indexCount)
  let v = 0
  let k = 0
  for (const points of polylines) {
    const n = points.length
    const base = v
    const at = (i: number) => points[closed ? (i + n) % n : Math.min(n - 1, Math.max(0, i))]!
    const direction = (a: [number, number], b: [number, number]) => {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      return [(b[0] - a[0]) / length, (b[1] - a[1]) / length] as const
    }
    const count = closed ? n + 1 : n
    for (let i = 0; i < count; i += 1) {
      const point = at(i)
      const hasPrevious = closed || i > 0
      const hasNext = closed || i < n - 1
      const before = hasPrevious ? direction(at(i - 1), point) : direction(point, at(i + 1))
      const after = hasNext ? direction(point, at(i + 1)) : before
      // 법선(진행 방향의 왼쪽)의 평균이 마이터 방향입니다. 급하게 꺾이는 곳은 뾰족하게 튀어나오지 않게 2배로 묶습니다.
      let mx = -(before[1] + after[1])
      let mz = before[0] + after[0]
      const ml = Math.hypot(mx, mz)
      if (ml < 1e-6) {
        mx = -after[1]
        mz = after[0]
      } else {
        mx /= ml
        mz /= ml
      }
      const dot = mx * -after[1] + mz * after[0]
      const reach = half / Math.max(dot, 0.5)
      // 열린 선의 양 끝은 반폭만큼 늘립니다.
      const extend = !closed && (i === 0 || i === n - 1) ? (i === 0 ? -half : half) : 0
      const cx = point[0] + after[0] * extend
      const cz = point[1] + after[1] * extend
      positions[v * 3] = (cx + mx * reach) / unit
      positions[v * 3 + 2] = (cz + mz * reach) / unit
      positions[v * 3 + 3] = (cx - mx * reach) / unit
      positions[v * 3 + 5] = (cz - mz * reach) / unit
      v += 2
    }
    for (let i = 0; i < count - 1; i += 1) {
      const a = base + i * 2
      index.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], k)
      k += 6
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setIndex(new BufferAttribute(index, 1))
  geometry.computeBoundingSphere()
  return geometry
}

function polygonGeometry(polygons: readonly Polygon[], unit: number) {
  const points = (ring: number[]) => {
    const list: Vector2[] = []
    for (let i = 0; i + 1 < ring.length; i += 2) list.push(new Vector2(ring[i]! / unit, ring[i + 1]! / unit))
    return list
  }
  const shapes = polygons.map(({ outer, holes }) => {
    const shape = new Shape(points(outer))
    shape.holes = holes.map((hole) => new Path(points(hole)))
    return shape
  })
  // ShapeGeometry는 XY 평면에 만들므로 눕혀서 (x, z) 지면에 놓습니다.
  const geometry = new ShapeGeometry(shapes)
  geometry.rotateX(Math.PI / 2)
  return geometry
}

/**
 * 지면 위 평면 레이어. 모두 같은 높이(0)에 있어 깊이 대신 그리는 순서(renderOrder, 음수라 미니어처보다 먼저)로 겹칩니다.
 */
export function flatLayer(geometry: BufferGeometry, color: string, order: number, opacity = 1) {
  const mesh = new Mesh(
    geometry,
    new MeshBasicMaterial({ color, side: DoubleSide, depthTest: false, depthWrite: false, transparent: opacity < 1, opacity }),
  )
  mesh.renderOrder = order
  return mesh
}

/** 공원 → 한강 → 도로(낮은 등급부터) 순서로 그린 바탕 */
export function buildSeoulMap(data: SeoulMapData, unit: number) {
  const group = new Group()
  group.add(flatLayer(polygonGeometry(data.parks, unit), '#0b130d', -40))
  group.add(flatLayer(polygonGeometry(data.water, unit), '#0a1420', -39))
  ROAD_STYLE.forEach(([kind, width, color], i) => group.add(flatLayer(ribbon(data.roads[kind] ?? [], width, unit), color, -38 + i)))
  return group
}
