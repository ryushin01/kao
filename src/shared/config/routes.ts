/**
 * 관제 지도 위의 주행 경로입니다. 좌표는 지도 단위(x, z)이고,
 * 서버는 길이로 위치를 계산하고 화면은 점을 이어 곡선을 그립니다.
 */
export interface RouteDefinition {
  id: string
  name: string
  /** 실제 한 바퀴 길이(km) */
  lengthKm: number
  points: ReadonlyArray<readonly [number, number]>
}

export const ROUTES: readonly RouteDefinition[] = [
  {
    id: 'urban-loop',
    name: '도심 순환로',
    lengthKm: 6.4,
    points: [
      [-17, -4], [-11, -9], [-4, -9], [-2, -4], [-6, 1], [-12, 3], [-17, 1],
    ],
  },
  {
    id: 'coastal-highway',
    name: '해안 고속 순환로',
    lengthKm: 14.2,
    points: [
      [2, -14], [12, -16], [20, -10], [19, -1], [13, 3], [6, 0], [3, -6],
    ],
  },
  {
    id: 'circuit',
    name: '서킷 A코스',
    lengthKm: 3.9,
    points: [
      [4, 6], [12, 5], [18, 8], [17, 13], [12, 12], [10, 16], [5, 17], [2, 12],
    ],
  },
  {
    id: 'riverside',
    name: '강변 자전거길',
    lengthKm: 2.6,
    points: [
      [-16, 8], [-10, 6], [-5, 9], [-4, 14], [-9, 17], [-15, 15],
    ],
  },
]

export function findRoute(id: string): RouteDefinition {
  const route = ROUTES.find((item) => item.id === id)
  if (!route) throw new Error(`알 수 없는 경로: ${id}`)
  return route
}
