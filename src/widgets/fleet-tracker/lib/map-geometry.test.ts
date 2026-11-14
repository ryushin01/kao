import { describe, expect, it } from 'vitest'
import { buildingArrays, buildMapLayers, decode, layerBuffers, polygonArrays, ribbonArrays, ROAD_STYLE } from './map-geometry'
import type { MeshArrays, SeoulMapData } from './map-geometry'

/** i번째 삼각형의 꼭짓점 세 개 */
const triangle = ({ positions, index }: MeshArrays, i: number) =>
  [0, 1, 2].map((k) => {
    const v = index[i * 3 + k]!
    return [positions[v * 3]!, positions[v * 3 + 1]!, positions[v * 3 + 2]!] as const
  })

/** 삼각형 면의 법선 방향((b - a) × (c - a)). three.js는 이 방향에서 볼 때 앞면입니다. */
function normal(points: ReturnType<typeof triangle>) {
  const [a, b, c] = [points[0]!, points[1]!, points[2]!]
  const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!]
  const w = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!]
  return [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!]
}

describe('decode', () => {
  it('첫 점부터 앞 점과의 차이를 더해 좌표를 되살립니다', () => {
    expect(Array.from(decode([10, 20, 5, -3, 0, 1]))).toEqual([10, 20, 15, 17, 15, 18])
  })

  it('건물은 첫 칸(높이)을 건너뜁니다', () => {
    expect(Array.from(decode([99, 10, 20, 5, -3], 1))).toEqual([10, 20, 15, 17])
  })
})

describe('ribbonArrays', () => {
  it('곧은 선은 폭만큼 벌린 띠가 되고, 열린 선은 양 끝을 반폭만큼 늘립니다', () => {
    const mesh = ribbonArrays([[0, 0, 100, 0]], 20, 10)
    // 점 2개 → 꼭짓점 4개, 삼각형 2개. 단위 10으로 나눠 장면 좌표가 됩니다.
    expect(mesh.index.length).toBe(6)
    expect(Array.from(mesh.positions)).toEqual([-1, 0, 1, -1, 0, -1, 11, 0, 1, 11, 0, -1])
  })

  it('꺾이는 점에서는 앞뒤 선분과 같은 거리만큼 떨어진 마이터 꼭짓점 하나로 이어집니다', () => {
    const p = ribbonArrays([[0, 0, 100, 0, 100, 100]], 20, 1).positions
    // 가운데 점(100, 0)의 바깥 꼭짓점은 (90, 10) 또는 (110, -10): 두 선분에서 모두 반폭(10)만큼 떨어짐
    const corner: Array<[number, number]> = [
      [p[6]!, p[8]!],
      [p[9]!, p[11]!],
    ]
    corner.sort((a, b) => a[0] - b[0])
    expect(corner[0]![0]).toBeCloseTo(90)
    expect(corner[0]![1]).toBeCloseTo(10)
    expect(corner[1]![0]).toBeCloseTo(110)
    expect(corner[1]![1]).toBeCloseTo(-10)
  })

  it('닫힌 선은 마지막 점에서 첫 점까지 이어 고리가 됩니다', () => {
    const square = ribbonArrays([[0, 0, 100, 0, 100, 100, 0, 100]], 10, 1, true)
    // 점 4개 + 처음으로 돌아오는 점 1개 → 선분 4개
    expect(square.index.length).toBe(4 * 6)
  })
})

describe('polygonArrays', () => {
  it('구멍 있는 다각형을 지면(y = 0) 삼각형으로 나눕니다', () => {
    // 100m 정사각형 안에 50m 정사각형 구멍(차분 부호화)
    const mesh = polygonArrays([{ outer: [0, 0, 100, 0, 0, 100, -100, 0], holes: [[25, 25, 50, 0, 0, 50, -50, 0]] }], 10)
    expect(mesh.positions.length).toBe(8 * 3)
    // 사각 고리는 삼각형 8개
    expect(mesh.index.length).toBe(8 * 3)
    expect(Array.from(mesh.positions.slice(0, 6))).toEqual([0, 0, 0, 10, 0, 0])
    // 넓이 합 = 100² − 50² (장면 좌표라 단위² = 100m²)
    let area = 0
    for (let i = 0; i < mesh.index.length / 3; i += 1) area += Math.abs(normal(triangle(mesh, i))[1]!) / 2
    expect(area).toBeCloseTo((100 * 100 - 50 * 50) / 100)
  })
})

describe('buildingArrays', () => {
  // 20m × 10m 바닥, 높이 30m. 반시계(지도 좌표에서 넓이 +)와 시계 방향 둘 다 같은 모양이 나와야 합니다.
  const counterClockwise = [30, 0, 0, 20, 0, 0, 10, -20, 0]
  const clockwise = [30, 0, 0, 0, 10, 20, 0, 0, -10]

  for (const [name, building] of [
    ['반시계', counterClockwise],
    ['시계', clockwise],
  ] as const) {
    it(`${name} 방향 바닥도 지붕은 위를, 벽은 바깥을 향합니다`, () => {
      const mesh = buildingArrays([building], 10)
      // 지붕 꼭짓점 4 + 벽 4면 × 4
      expect(mesh.positions.length / 3).toBe(4 + 16)
      // 지붕 삼각형 2 + 벽 4면 × 2
      expect(mesh.index.length / 3).toBe(2 + 8)
      const center = [1, 1.5, 0.5]
      for (let i = 0; i < mesh.index.length / 3; i += 1) {
        const points = triangle(mesh, i)
        const n = normal(points)
        const roof = points.every((p) => p[1] === 3)
        if (roof) {
          expect(n[1]).toBeGreaterThan(0)
        } else {
          // 벽: 법선이 건물 가운데에서 그 벽 쪽으로 향합니다.
          const mid = [0, 2].map((axis) => points.reduce((sum, p) => sum + p[axis]!, 0) / 3)
          expect(n[0]! * (mid[0]! - center[0]!) + n[2]! * (mid[1]! - center[2]!)).toBeGreaterThan(0)
          expect(n[1]).toBeCloseTo(0)
        }
      }
    })
  }

  it('벽은 위쪽이 아래쪽보다 밝고, 북동쪽 면은 붉은 역광을 받습니다', () => {
    const mesh = buildingArrays([counterClockwise], 10)
    const colors = mesh.colors!
    const color = (vertex: number) => [colors[vertex * 3]!, colors[vertex * 3 + 1]!, colors[vertex * 3 + 2]!]
    // 첫 벽은 (0,0)→(20,0): 북쪽(z −)을 보는 면. 꼭짓점 순서는 아래 둘, 위 둘
    const [bottom, , top] = [color(4), color(5), color(6)]
    expect(top[0]!).toBeGreaterThan(bottom[0]!)
    expect(top[0]!).toBeGreaterThan(top[2]!)
  })
})

describe('buildMapLayers', () => {
  const data: SeoulMapData = {
    version: 2,
    attribution: '© OpenStreetMap 기여자',
    bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
    detail: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
    roads: { minor: [[0, 0, 10, 0]], cycleway: [], tertiary: [], link: [], secondary: [], primary: [[0, 0, 0, 50]], trunk: [] },
    water: [{ outer: [0, 0, 10, 0, 0, 10], holes: [] }],
    parks: [],
    buildings: [[40, 0, 0, 10, 0, 0, 10, -10, 0]],
  }

  it('도로는 낮은 등급부터 ROAD_STYLE 순서로 만듭니다', () => {
    const layers = buildMapLayers(data, 1)
    expect(layers.roads.map((road) => road.kind)).toEqual(ROAD_STYLE.map(([kind]) => kind))
    expect(layers.roads[0]!.mesh.index.length).toBe(6)
    expect(layers.water.index.length).toBe(3)
    expect(layers.buildings.colors).toBeDefined()
  })

  it('워커가 넘길 버퍼는 서로 겹치지 않습니다(같은 버퍼를 두 번 넘기면 postMessage가 실패)', () => {
    const buffers = layerBuffers(buildMapLayers(data, 1))
    expect(new Set(buffers).size).toBe(buffers.length)
    // 공원·물·건물(색 포함)·도로 7등급 × 2
    expect(buffers.length).toBe(2 + 2 + 3 + 7 * 2)
  })
})
