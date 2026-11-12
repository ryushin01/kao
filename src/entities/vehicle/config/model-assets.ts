import type { VehicleModelId } from '@shared/api'

export interface ModelAsset {
  url: string
  /** 관제 지도용 가벼운 버전 */
  liteUrl: string
  /** 실제 전장(m) */
  length: number
  /** wheel_N 노드의 반지름(m) */
  wheelRadii: number[]
  leans: boolean
  /** CC BY 4.0 출처 표기 */
  credit: { title: string; author: string; authorUrl: string; source: string; license: string; licenseUrl: string }
}

const CC_BY = { license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' }

/** Sketchfab 원본을 scripts/build-models.mjs로 바꾼 실제 3D 모델. 없는 모델은 직접 만든 모형을 씁니다. */
export const MODEL_ASSETS: Partial<Record<VehicleModelId, ModelAsset>> = {
  'genesis-g80': {
    url: '/models/genesis-g80.glb',
    liteUrl: '/models/genesis-g80.lite.glb',
    length: 4.995,
    wheelRadii: [0.36, 0.36, 0.36, 0.36],
    leans: false,
    credit: {
      title: 'Genesis G80',
      author: 'Nieve5677',
      authorUrl: 'https://sketchfab.com/niev',
      source: 'https://sketchfab.com/3d-models/genesis-g80-e9abf10cfee04ea480951d3c2f71f060',
      ...CC_BY,
    },
  },
  'lamborghini-aventador': {
    url: '/models/lamborghini-aventador.glb',
    liteUrl: '/models/lamborghini-aventador.lite.glb',
    length: 4.868,
    wheelRadii: [0.33, 0.33, 0.355, 0.355],
    leans: false,
    credit: {
      title: '2022 Lamborghini Aventador LP780-4 Ultimae',
      author: 'Ddiaz Design',
      authorUrl: 'https://sketchfab.com/ddiaz-design',
      source: 'https://sketchfab.com/3d-models/2022-lamborghini-aventador-lp780-4-ultimae-714a8795e58442258f96bd364b9096b1',
      ...CC_BY,
    },
  },
  'ducati-panigale-v4s': {
    url: '/models/ducati-panigale-v4s.glb',
    liteUrl: '/models/ducati-panigale-v4s.lite.glb',
    length: 2.11,
    wheelRadii: [0.3, 0.33],
    leans: true,
    credit: {
      title: 'Ducati Panigale V4',
      author: 'ROY',
      authorUrl: 'https://sketchfab.com/roy.gearloft.in',
      source: 'https://sketchfab.com/3d-models/ducati-panigale-v4-47f87e3d70f644289e34cbff91255d0c',
      ...CC_BY,
    },
  },
}
