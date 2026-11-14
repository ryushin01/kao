import { describe, expect, it } from 'vitest'
import { describeLocation } from './describe-location'

describe('describeLocation', () => {
  it('가장 가까운 지명에서 본 방향과 거리로 나타냅니다', () => {
    // 남산서울타워(37.5512, 126.9882)에서 북쪽 약 400m, 동쪽 약 400m
    expect(describeLocation(37.5548, 126.9927)).toBe('남산서울타워 북동쪽 약 550m')
    // 경로에서 몇 km 떨어진 강남역 근처는 가장 가까운 반포대교에서 잽니다.
    expect(describeLocation(37.4985, 127.0276)).toBe('반포대교 남동쪽 약 3.2km')
  })

  it('지명 바로 옆(50m 안)은 부근이라고 합니다', () => {
    expect(describeLocation(37.5759, 126.977)).toBe('광화문 부근')
  })
})
