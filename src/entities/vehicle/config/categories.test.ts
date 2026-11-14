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

  it('소개 화면에만 나오는 분류(전기자동차·SUV·MPV)는 보여 줄 도장이 있고, MPV 대표 모델(알파드)은 검정입니다', () => {
    for (const kind of ['ev', 'suv', 'mpv']) {
      expect(VEHICLE_CATEGORIES.find((category) => category.kind === kind)!.showcase?.paint.hex).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(VEHICLE_CATEGORIES.find((category) => category.kind === 'mpv')).toMatchObject({
      representative: 'toyota-alphard',
      showcase: { paint: { name: '블랙' } },
    })
  })

  it('분류마다 대표 모델이 있고, 자전거를 뺀 대표 모델은 실제 3D 모델을 씁니다', () => {
    for (const category of VEHICLE_CATEGORIES) {
      expect(MODEL_PROFILES[category.representative]).toBeDefined()
      if (category.kind !== 'bicycle') expect(MODEL_ASSETS[category.representative]?.url).toMatch(/\.glb$/)
    }
  })
})
