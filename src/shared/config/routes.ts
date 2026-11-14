/**
 * 관제 지도 위의 주행 경로입니다. 좌표는 지도 단위(x, z)이고,
 * 서버는 길이로 위치를 계산하고 화면은 점을 이어 곡선을 그립니다.
 * geo는 실차 GPS를 경로에 맞출 때 쓰는 기준 좌표입니다. 경로 모양을 실제 길이로 키워 이 좌표 둘레에 놓은 가상 코스입니다.
 */
export interface RouteDefinition {
  id: string
  name: string
  /** 실제 한 바퀴 길이(km) */
  lengthKm: number
  points: ReadonlyArray<readonly [number, number]>
  /** 경로 중심의 위도·경도 */
  geo: { lat: number; lng: number }
}

export const ROUTES: readonly RouteDefinition[] = [
  {
    id: 'urban-loop',
    name: '도심 순환로',
    lengthKm: 6.4,
    points: [
      [-17, -4], [-11, -9], [-4, -9], [-2, -4], [-6, 1], [-12, 3], [-17, 1],
    ],
    geo: { lat: 37.5665, lng: 126.978 },
  },
  {
    id: 'coastal-highway',
    name: '해안 고속 순환로',
    lengthKm: 14.2,
    points: [
      [2, -14], [12, -16], [20, -10], [19, -1], [13, 3], [6, 0], [3, -6],
    ],
    geo: { lat: 35.1631, lng: 129.1636 },
  },
  {
    id: 'circuit',
    name: '서킷 A코스',
    lengthKm: 3.9,
    points: [
      [4, 6], [12, 5], [18, 8], [17, 13], [12, 12], [10, 16], [5, 17], [2, 12],
    ],
    geo: { lat: 38.0011, lng: 128.2908 },
  },
  {
    id: 'riverside',
    name: '강변 자전거길',
    lengthKm: 2.6,
    points: [
      [-16, 8], [-10, 6], [-5, 9], [-4, 14], [-9, 17], [-15, 15],
    ],
    geo: { lat: 37.5284, lng: 126.9326 },
  },
]

export function findRoute(id: string): RouteDefinition {
  const route = ROUTES.find((item) => item.id === id)
  if (!route) throw new Error(`알 수 없는 경로: ${id}`)
  return route
}
