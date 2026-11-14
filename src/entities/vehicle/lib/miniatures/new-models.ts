import { box } from './parts'
import type { Miniature } from './parts'
import { createSimpleCar } from './simple-car'

/**
 * 전기자동차·SUV·MPV 대표 모델의 단순 모형. 바퀴 위치와 높이는 실제 3D 모델(scripts/build-models.mjs)에서 잰 값입니다.
 */

/** Genesis Essentia Concept(2018): 낮고 긴 2도어 전기 GT. 공식 치수가 없어 3D 모델 비율을 씁니다. */
export function createGenesisEssentia(paintHex: string): Miniature {
  return createSimpleCar(
    {
      length: 4.6,
      width: 1.96,
      wheelRadius: 0.39,
      wheelWidth: 0.3,
      track: 0.85,
      axles: [1.45, -1.38],
      sill: 0.18,
      body: [
        [2.22, 0.18],
        [2.3, 0.4],
        [2.2, 0.6],
        [1.9, 0.72],
        [1.2, 0.8],
        [0.4, 0.86],
        [-0.6, 0.9],
        [-1.7, 0.9],
        [-2.2, 0.86],
        [-2.3, 0.7],
        [-2.3, 0.4],
        [-2.2, 0.18],
      ],
      cabin: [
        [0.9, 0.84],
        [0.15, 1.2],
        [-0.4, 1.26],
        [-1.0, 1.22],
        [-1.9, 0.92],
        [-1.9, 0.86],
      ],
      cabinWidth: 1.5,
      lamps: { front: 0.62, rear: 0.76, width: 0.5 },
      rim: 'dark',
      spokes: 10,
    },
    paintHex,
  )
}

/** Renault Arkana(2019, 러시아형): 쿠페형 지붕선의 SUV. 전장 4,545 · 축거 2,721mm */
export function createRenaultArkana(paintHex: string): Miniature {
  return createSimpleCar(
    {
      length: 4.545,
      width: 1.82,
      wheelRadius: 0.345,
      wheelWidth: 0.22,
      track: 0.81,
      axles: [1.435, -1.305],
      sill: 0.3,
      body: [
        [2.16, 0.3],
        [2.27, 0.5],
        [2.24, 0.78],
        [2.0, 0.92],
        [1.4, 1.0],
        [0.7, 1.05],
        [-0.6, 1.08],
        [-1.8, 1.06],
        [-2.2, 1.0],
        [-2.27, 0.8],
        [-2.27, 0.45],
        [-2.16, 0.3],
      ],
      cabin: [
        [0.9, 1.02],
        [0.15, 1.48],
        [-0.3, 1.565],
        [-0.9, 1.52],
        [-1.9, 1.1],
        [-1.9, 1.04],
      ],
      cabinWidth: 1.5,
      roof: [
        [0.2, 1.47],
        [-0.3, 1.565],
        [-0.9, 1.53],
        [-0.95, 1.5],
        [-0.3, 1.53],
        [0.18, 1.45],
      ],
      grille: [
        [0.5, 0.82],
        [0.55, 0.6],
        [-0.55, 0.6],
        [-0.5, 0.82],
      ],
      lamps: { front: 0.8, rear: 0.98, width: 0.4 },
      rim: 'bright',
      spokes: 10,
      extras: (root, m) => {
        // 검은 휠아치 몰딩과 아래 보호판(SUV)
        root.add(box([4.3, 0.12, 1.84], [0, 0.36, 0], m.trim))
      },
    },
    paintHex,
  )
}

/** Toyota Alphard(2025, 4세대): 키 큰 상자형 MPV와 큰 그릴. 전장 4,995 · 전고 1,935 · 축거 3,000mm */
export function createToyotaAlphard(paintHex: string): Miniature {
  return createSimpleCar(
    {
      length: 4.995,
      width: 1.85,
      wheelRadius: 0.365,
      wheelWidth: 0.23,
      track: 0.815,
      axles: [1.545, -1.455],
      sill: 0.24,
      body: [
        [2.38, 0.24],
        [2.5, 0.45],
        [2.5, 1.0],
        [2.3, 1.12],
        [1.6, 1.22],
        [-2.4, 1.22],
        [-2.5, 1.1],
        [-2.5, 0.45],
        [-2.38, 0.24],
      ],
      cabin: [
        [1.6, 1.2],
        [0.95, 1.86],
        [0.8, 1.9],
        [-2.35, 1.9],
        [-2.45, 1.8],
        [-2.45, 1.2],
      ],
      cabinWidth: 1.72,
      roof: [
        [0.9, 1.86],
        [0.8, 1.935],
        [-2.38, 1.935],
        [-2.42, 1.86],
      ],
      grille: [
        [0.7, 1.0],
        [0.76, 0.5],
        [0.5, 0.28],
        [-0.5, 0.28],
        [-0.76, 0.5],
        [-0.7, 1.0],
      ],
      lamps: { front: 1.0, rear: 1.15, width: 0.42 },
      rim: 'bright',
      spokes: 12,
      extras: (root, m) => {
        // 큰 그릴의 크롬 테
        root.add(box([0.02, 0.03, 1.5], [2.515, 1.0, 0], m.chrome))
        // 미닫이 뒷문 레일
        for (const side of [1, -1] as const) root.add(box([1.4, 0.03, 0.02], [-1.3, 1.2, side * 0.935], m.chrome))
      },
    },
    paintHex,
  )
}
