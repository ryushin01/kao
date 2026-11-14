import type { VehicleModelId } from '@shared/api'

export interface ModelAsset {
  url: string
  /** 관제 지도용 가벼운 버전. 관제 지도에 나오지 않는 대표 모델(소개 화면만)은 없습니다. */
  liteUrl?: string
  /** 실제 전장(m) */
  length: number
  /** wheel_N 노드의 반지름(m) */
  wheelRadii: number[]
  leans: boolean
}

/**
 * Sketchfab 원본을 scripts/build-models.mjs로 바꾼 실제 3D 모델. 없는 모델은 직접 만든 모형을 씁니다.
 * 원작자와 라이선스(CC BY 4.0)는 README의 '출처'에 있습니다.
 */
export const MODEL_ASSETS: Partial<Record<VehicleModelId, ModelAsset>> = {
  'genesis-g80': {
    url: '/models/genesis-g80.glb',
    liteUrl: '/models/genesis-g80.lite.glb',
    length: 4.995,
    wheelRadii: [0.36, 0.36, 0.36, 0.36],
    leans: false,
  },
  'lamborghini-aventador': {
    url: '/models/lamborghini-aventador.glb',
    liteUrl: '/models/lamborghini-aventador.lite.glb',
    length: 4.868,
    wheelRadii: [0.33, 0.33, 0.355, 0.355],
    leans: false,
  },
  'ducati-panigale-v4s': {
    url: '/models/ducati-panigale-v4s.glb',
    liteUrl: '/models/ducati-panigale-v4s.lite.glb',
    length: 2.11,
    wheelRadii: [0.3, 0.33],
    leans: true,
  },
  'genesis-essentia': {
    url: '/models/genesis-essentia.glb',
    length: 4.6,
    wheelRadii: [0.39, 0.39, 0.39, 0.39],
    leans: false,
  },
  'renault-arkana': {
    url: '/models/renault-arkana.glb',
    length: 4.545,
    wheelRadii: [0.345, 0.345, 0.345, 0.345],
    leans: false,
  },
  'toyota-alphard': {
    url: '/models/toyota-alphard.glb',
    length: 4.995,
    wheelRadii: [0.365, 0.365, 0.365, 0.365],
    leans: false,
  },
}
