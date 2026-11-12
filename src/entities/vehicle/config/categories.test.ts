import { describe, expect, it } from 'vitest'
import { MODEL_ASSETS } from './model-assets'
import { CATEGORY_LABELS, VEHICLE_CATEGORIES } from './categories'
import { MODEL_PROFILES } from './models'

describe('탈것 분류', () => {
  it('세단·슈퍼카·슈퍼바이크·자전거 네 분류가 이 순서로 있습니다', () => {
    expect(VEHICLE_CATEGORIES.map((category) => category.label)).toEqual(['세단', '슈퍼카', '슈퍼바이크', '자전거'])
    expect(CATEGORY_LABELS.superbike).toBe('슈퍼바이크')
  })

  it('분류마다 대표 모델이 있고, 자전거를 뺀 대표 모델은 실제 3D 모델을 씁니다', () => {
    for (const category of VEHICLE_CATEGORIES) {
      expect(MODEL_PROFILES[category.representative]).toBeDefined()
      if (category.kind !== 'bicycle') expect(MODEL_ASSETS[category.representative]?.url).toMatch(/\.glb$/)
    }
  })
})
