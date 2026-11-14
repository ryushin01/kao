import { describe, expect, it } from 'vitest'
import { ribbon } from './seoul-map'

const positions = (geometry: ReturnType<typeof ribbon>) => Array.from(geometry.getAttribute('position').array as Float32Array)

describe('ribbon', () => {
  it('곧은 선은 폭만큼 벌린 띠가 되고, 열린 선은 양 끝을 반폭만큼 늘립니다', () => {
    const geometry = ribbon([[0, 0, 100, 0]], 20, 10)
    // 점 2개 → 꼭짓점 4개, 삼각형 2개. 단위 10으로 나눠 장면 좌표가 됩니다.
    expect(geometry.getIndex()!.count).toBe(6)
    expect(positions(geometry)).toEqual([-1, 0, 1, -1, 0, -1, 11, 0, 1, 11, 0, -1])
  })

  it('꺾이는 점에서는 앞뒤 선분과 같은 거리만큼 떨어진 마이터 꼭짓점 하나로 이어집니다', () => {
    const geometry = ribbon([[0, 0, 100, 0, 100, 100]], 20, 1)
    const p = positions(geometry)
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
    const square = ribbon([[0, 0, 100, 0, 100, 100, 0, 100]], 10, 1, true)
    // 점 4개 + 처음으로 돌아오는 점 1개 → 선분 4개
    expect(square.getIndex()!.count).toBe(4 * 6)
  })
})
