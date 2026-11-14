import { describe, expect, it } from 'vitest'
import { MODEL_ASSETS } from './model-assets'
import { CATEGORY_LABELS, VEHICLE_CATEGORIES } from './categories'
import { MODEL_PROFILES } from './models'

describe('탈것 분류', () => {
  it('세단·슈퍼카·슈퍼바이크·자전거·전기자동차·SUV·MPV 일곱 분류가 이 순서로 있습니다', () => {
    expect(VEHICLE_CATEGORIES.map((category) => category.label)).toEqual(['세단', '슈퍼카', '슈퍼바이크', '자전거', '전기자동차', 'SUV', 'MPV'])
    expect(CATEGORY_LABELS.superbike).toBe('슈퍼바이크')
    expect(CATEGORY_LABELS.mpv).toBe('MPV')
  })

  // 분류마다 대표 모델의 등록 탈것이 관제 지도에서 달리는지는 server/utils/fleet-specs.test.ts가 확인합니다.
  it('분류마다 대표 모델이 있고, 자전거를 뺀 대표 모델은 실제 3D 모델과 관제 지도용 가벼운 버전을 씁니다', () => {
    for (const category of VEHICLE_CATEGORIES) {
      expect(MODEL_PROFILES[category.representative]).toBeDefined()
      if (category.kind === 'bicycle') continue
      expect(MODEL_ASSETS[category.representative]?.url).toMatch(/\.glb$/)
      expect(MODEL_ASSETS[category.representative]?.liteUrl).toMatch(/\.lite\.glb$/)
    }
  })
})
