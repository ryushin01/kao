import type { DataTexture } from 'three'
import { describe, expect, it } from 'vitest'
import { edgeFade, ribbon } from './seoul-map'

describe('ribbon', () => {
  it('띠 배열로 three.js 도형을 만듭니다', () => {
    const geometry = ribbon([[0, 0, 100, 0]], 20, 10)
    expect(geometry.getIndex()!.count).toBe(6)
    expect(geometry.getAttribute('position').count).toBe(4)
    expect(geometry.boundingSphere).not.toBeNull()
  })
})

describe('edgeFade', () => {
  it('지도 안쪽은 투명하고, 끝으로 갈수록 바닥색이 진해져 범위 밖은 불투명합니다', () => {
    const { mesh, dispose } = edgeFade({ minX: 0, maxX: 10_000, minZ: 0, maxZ: 10_000 }, 1000, 100, '#060404')
    const texture = mesh.material.alphaMap as DataTexture
    const { data, width } = texture.image as { data: Uint8Array; width: number }
    const alpha = (column: number, row: number) => data[(row * width + column) * 4 + 1]!
    const middle = width / 2
    expect(alpha(middle, middle)).toBe(0)
    // 판은 범위보다 fade/2만큼 넓어, 가장자리 칸은 범위 밖(불투명)입니다.
    expect(alpha(0, middle)).toBe(255)
    expect(alpha(middle, width - 1)).toBe(255)
    // 범위 끝 근처는 그 사이
    const nearEdge = alpha(Math.round(width * 0.08), middle)
    expect(nearEdge).toBeGreaterThan(0)
    expect(nearEdge).toBeLessThan(255)
    // 판 가운데는 지도 가운데(장면 좌표 = m / 100)
    mesh.geometry.computeBoundingBox()
    const box = mesh.geometry.boundingBox!
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(50)
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(50)
    dispose()
  })
})
