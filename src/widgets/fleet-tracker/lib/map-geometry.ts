import { Earcut } from 'three/src/extras/Earcut.js'

/**
 * 관제 지도 바탕(도로·물·공원·건물)의 도형을 typed array로 만듭니다. three.js 객체를 만들지 않으므로 웹 워커에서도 돌고,
 * 결과 배열은 복사 없이 메인 스레드로 넘깁니다(transfer). 입력은 scripts/build-seoul-map.mjs가 만든 public/maps/seoul.json이고
 * (지도 데이터 © OpenStreetMap 기여자, ODbL), 출력 좌표는 지도 좌표(m)를 unit으로 나눈 장면 좌표입니다.
 */

export type RoadKind = 'minor' | 'cycleway' | 'tertiary' | 'link' | 'secondary' | 'primary' | 'trunk'

export interface MapBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

interface EncodedPolygon {
  /** 바깥 둘레 [x0, z0, dx1, dz1, …](m, 차분 부호화) */
  outer: number[]
  holes: number[][]
}

export interface SeoulMapData {
  version: 2
  attribution: string
  /** 지도 전체(큰길·물·공원을 그린 바깥 고리까지) 범위(m) */
  bounds: MapBounds
  /** 골목길·건물까지 자세히 그린 안쪽 범위(m) */
  detail: MapBounds
  /** 등급별 도로 중심선 [x0, z0, dx1, dz1, …](m, 차분 부호화) */
  roads: Record<RoadKind, number[][]>
  water: EncodedPolygon[]
  parks: EncodedPolygon[]
  /** 높은 건물 [높이(m), x0, z0, dx1, dz1, …] 바닥 둘레(차분 부호화) */
  buildings: number[][]
}

export interface MeshArrays {
  positions: Float32Array
  index: Uint32Array
  /** 꼭짓점 색(선형 RGB). 없으면 재질 색 하나로 칠합니다. */
  colors?: Float32Array
}

export interface SeoulMapLayers {
  bounds: MapBounds
  parks: MeshArrays
  water: MeshArrays
  /** ROAD_STYLE 순서(낮은 등급부터) */
  roads: Array<{ kind: RoadKind; mesh: MeshArrays }>
  buildings: MeshArrays
}

/** 도로 등급별 폭(m, 멀리서도 보이게 실제보다 넓게)과 색. 낮은 등급부터 그려 큰길이 위에 옵니다. */
export const ROAD_STYLE: ReadonlyArray<readonly [RoadKind, number, string]> = [
  ['minor', 9, '#1a1617'],
  ['cycleway', 7, '#121d25'],
  ['tertiary', 16, '#272223'],
  ['link', 14, '#2e2829'],
  ['secondary', 22, '#353031'],
  ['primary', 30, '#423b3c'],
  ['trunk', 40, '#524849'],
]

/** 차분 부호화를 풉니다. [x0, z0, dx1, dz1, …] → [x0, z0, x1, z1, …]. offset만큼 앞 칸(건물 높이)은 건너뜁니다. */
export function decode(encoded: ArrayLike<number>, offset = 0) {
  const count = Math.floor((encoded.length - offset) / 2)
  const out = new Float64Array(count * 2)
  let x = 0
  let z = 0
  for (let i = 0; i < count; i += 1) {
    x += encoded[offset + i * 2]!
    z += encoded[offset + i * 2 + 1]!
    out[i * 2] = x
    out[i * 2 + 1] = z
  }
  return out
}

/**
 * 선을 따라 폭이 일정한 띠(평면, y = 0). 꺾이는 점에서는 앞뒤 선분의 법선을 평균 낸 방향(마이터)으로 벌려
 * 바깥선이 매끄럽게 이어지고, 열린 선은 양 끝을 반폭만큼 늘려 다른 길과 만나는 곳이 비지 않게 합니다.
 * lines는 [x0, z0, x1, z1, …](m)이고, unit(m)으로 나눠 장면 좌표로 바꿉니다. closed면 마지막 점이 첫 점으로 이어집니다.
 */
export function ribbonArrays(lines: ReadonlyArray<ArrayLike<number>>, width: number, unit: number, closed = false): MeshArrays {
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
  return { positions, index }
}

/** 구멍이 있는 다각형(한강·공원)을 지면(y = 0) 삼각형으로 나눕니다. 평면 레이어는 양면으로 그려 감은 방향은 상관없습니다. */
export function polygonArrays(polygons: readonly EncodedPolygon[], unit: number): MeshArrays {
  const positions: number[] = []
  const index: number[] = []
  for (const { outer, holes } of polygons) {
    const flat = Array.from(decode(outer))
    const holeIndices: number[] = []
    for (const hole of holes) {
      holeIndices.push(flat.length / 2)
      for (const value of decode(hole)) flat.push(value)
    }
    const base = positions.length / 3
    for (let i = 0; i + 1 < flat.length; i += 2) positions.push(flat[i]! / unit, 0, flat[i + 1]! / unit)
    for (const vertex of Earcut.triangulate(flat, holeIndices, 2)) index.push(base + vertex)
  }
  return { positions: new Float32Array(positions), index: new Uint32Array(index) }
}

/** '#rrggbb'(sRGB) → 선형 RGB. 꼭짓점 색은 선형 공간 값이어야 합니다. */
function linear(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
}

/**
 * 건물 색. 조명 계산 없이 면 방향으로 미리 칠합니다(관제 지도의 다른 평면 레이어처럼 MeshBasicMaterial).
 * 벽은 남서쪽 해(장면의 sun)를 받는 면이 밝고, 북동쪽 붉은 역광(rim)을 받는 면이 붉으며, 아래로 갈수록 어둡습니다.
 */
const BUILDING_COLOR = {
  roof: linear('#2e2528'),
  wall: linear('#151012'),
  sun: linear('#2e2628'),
  rim: linear('#5c1612'),
}
/** 지면에서 빛이 오는 방향(지도 좌표 x, z 단위 벡터). 장면의 sun(-12, 30, 18)·rim(20, 8, -25) 조명과 맞춥니다. */
const SUN_DIRECTION = [-12 / Math.hypot(12, 18), 18 / Math.hypot(12, 18)] as const
const RIM_DIRECTION = [20 / Math.hypot(20, 25), -25 / Math.hypot(20, 25)] as const
/** 벽 아래쪽 밝기 비율(위쪽 1) */
const WALL_BASE_SHADE = 0.4

/** 건물마다 밝기를 조금씩 달리해(0.8~1.2배) 덩어리가 한 색으로 뭉쳐 보이지 않게 합니다. 바닥 첫 점으로 정해 늘 같습니다. */
function buildingShade(x: number, z: number) {
  const value = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453
  return 0.8 + 0.4 * (value - Math.floor(value))
}

/**
 * 높은 건물을 바닥 둘레를 높이만큼 세운 각기둥(지붕 + 벽)으로 만듭니다. 바닥 면은 보이지 않아 만들지 않습니다.
 * 앞면만 그리므로 지붕은 위(+y), 벽은 바깥을 향하게 감습니다(바닥 둘레가 어느 방향으로 감겨 있든).
 */
export function buildingArrays(buildings: readonly number[][], unit: number, heightScale = 1): MeshArrays {
  const rings = buildings.map((building) => ({ height: ((building[0] ?? 0) * heightScale) / unit, ring: decode(building, 1) })).filter(({ ring }) => ring.length >= 6)
  let vertexCount = 0
  let indexCount = 0
  for (const { ring } of rings) {
    const n = ring.length / 2
    vertexCount += n + n * 4
    indexCount += (n - 2) * 3 + n * 6
  }
  const positions = new Float32Array(vertexCount * 3)
  const colors = new Float32Array(vertexCount * 3)
  const index = new Uint32Array(indexCount)
  let v = 0
  let k = 0
  const vertex = (x: number, y: number, z: number, color: readonly number[], shade = 1) => {
    positions[v * 3] = x / unit
    positions[v * 3 + 1] = y
    positions[v * 3 + 2] = z / unit
    colors[v * 3] = color[0]! * shade
    colors[v * 3 + 1] = color[1]! * shade
    colors[v * 3 + 2] = color[2]! * shade
    return v++
  }
  for (const { height, ring } of rings) {
    const n = ring.length / 2
    const shade = buildingShade(ring[0]!, ring[1]!)
    let area = 0
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n
      area += ring[i * 2]! * ring[j * 2 + 1]! - ring[j * 2]! * ring[i * 2 + 1]!
    }
    // 지도 좌표(x 동쪽, z 남쪽)에서 넓이가 +면 반시계 방향이고, 변 (dx, dz)의 바깥쪽은 (dz, -dx)입니다.
    const ccw = area > 0

    // 지붕: 위에서 볼 때 앞면이 되도록 (b - a) × (c - a)의 y가 +인 순서로 둡니다.
    const roof = v
    for (let i = 0; i < n; i += 1) vertex(ring[i * 2]!, height, ring[i * 2 + 1]!, BUILDING_COLOR.roof, shade)
    const triangles = Earcut.triangulate(Array.from(ring), [], 2)
    for (let t = 0; t + 2 < triangles.length; t += 3) {
      const a = triangles[t]!
      let b = triangles[t + 1]!
      let c = triangles[t + 2]!
      const cross = (ring[b * 2]! - ring[a * 2]!) * (ring[c * 2 + 1]! - ring[a * 2 + 1]!) - (ring[c * 2]! - ring[a * 2]!) * (ring[b * 2 + 1]! - ring[a * 2 + 1]!)
      if (cross > 0) [b, c] = [c, b]
      index.set([roof + a, roof + b, roof + c], k)
      k += 3
    }

    // 벽: 변마다 사각형 하나(꼭짓점 4개, 면 색을 따로 칠하려고 이웃 벽과 꼭짓점을 나누지 않습니다).
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n
      const ax = ring[i * 2]!
      const az = ring[i * 2 + 1]!
      const bx = ring[j * 2]!
      const bz = ring[j * 2 + 1]!
      const length = Math.hypot(bx - ax, bz - az) || 1
      const sign = ccw ? 1 : -1
      const nx = (sign * (bz - az)) / length
      const nz = (sign * -(bx - ax)) / length
      const sun = Math.max(0, nx * SUN_DIRECTION[0] + nz * SUN_DIRECTION[1])
      const rim = Math.max(0, nx * RIM_DIRECTION[0] + nz * RIM_DIRECTION[1])
      const color = [0, 1, 2].map((c) => BUILDING_COLOR.wall[c]! + sun * BUILDING_COLOR.sun[c]! + rim * BUILDING_COLOR.rim[c]!)
      const a0 = vertex(ax, 0, az, color, shade * WALL_BASE_SHADE)
      const b0 = vertex(bx, 0, bz, color, shade * WALL_BASE_SHADE)
      const a1 = vertex(ax, height, az, color, shade)
      const b1 = vertex(bx, height, bz, color, shade)
      // 바깥쪽에서 볼 때 반시계가 되도록: 반시계 둘레면 (a0, b1, b0)·(a0, a1, b1), 시계 둘레면 반대로 감습니다.
      index.set(ccw ? [a0, b1, b0, a0, a1, b1] : [a0, b0, b1, a0, b1, a1], k)
      k += 6
    }
  }
  // 겹친 점이 있는 둘레는 삼각형이 n - 2개보다 적게 나올 수 있어 실제로 채운 만큼만 남깁니다.
  return { positions, colors, index: k === index.length ? index : index.slice(0, k) }
}

/** seoul.json(차분 부호화)으로 모든 레이어의 도형을 만듭니다. */
export function buildMapLayers(data: SeoulMapData, unit: number): SeoulMapLayers {
  return {
    bounds: data.bounds,
    parks: polygonArrays(data.parks, unit),
    water: polygonArrays(data.water, unit),
    roads: ROAD_STYLE.map(([kind, width]) => ({ kind, mesh: ribbonArrays((data.roads[kind] ?? []).map((line) => decode(line)), width, unit) })),
    buildings: buildingArrays(data.buildings ?? [], unit),
  }
}

/** 워커에서 메인 스레드로 복사 없이 넘길 배열 버퍼 */
export function layerBuffers(layers: SeoulMapLayers) {
  const meshes = [layers.parks, layers.water, layers.buildings, ...layers.roads.map((road) => road.mesh)]
  return meshes.flatMap((mesh) => [mesh.positions.buffer, mesh.index.buffer, ...(mesh.colors ? [mesh.colors.buffer] : [])]) as ArrayBuffer[]
}
