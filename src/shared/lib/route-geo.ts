import type { RouteDefinition } from '../config/routes'

/**
 * 위도·경도와 관제 지도 좌표(지도 중심 기준 m) 사이를 오가고, 경로 위 위치(0 이상 1 미만)를 계산합니다.
 * 관제 지도(three.js), 서버(GPS를 경로 위치로), 데모 장치·지도 생성 스크립트(Node)가 함께 쓰므로
 * 타입만 가져오고 다른 모듈을 쓰지 않습니다(Node가 TS 파일을 그대로 불러올 수 있게).
 */

/** 관제 지도 중심(서울 도심과 한강 사이) */
export const MAP_CENTER = { lat: 37.54, lng: 126.961 } as const
const METERS_PER_DEGREE = 111_320
const COS_CENTER = Math.cos((MAP_CENTER.lat * Math.PI) / 180)

/** 위도·경도 → 지도 좌표(m). x는 동쪽, z는 남쪽이 +입니다(지도를 위에서 보면 -z가 북쪽). */
export function toLocal(lat: number, lng: number) {
  return { x: (lng - MAP_CENTER.lng) * METERS_PER_DEGREE * COS_CENTER, z: -(lat - MAP_CENTER.lat) * METERS_PER_DEGREE }
}

/** 지도 좌표(m) → 위도·경도 */
export function fromLocal(x: number, z: number) {
  return { lat: MAP_CENTER.lat - z / METERS_PER_DEGREE, lng: MAP_CENTER.lng + x / (METERS_PER_DEGREE * COS_CENTER) }
}

export interface RouteMatch {
  /** 경로 위 위치(0 이상 1 미만, 길이 기준) */
  progress: number
  /** 경로에서 떨어진 거리(m) */
  distance: number
}

export interface RouteGeo {
  /** 한 바퀴 길이(m, 지도 좌표 기준) */
  length: number
  /** 경로 위 위치의 지도 좌표(m) */
  pointAt: (progress: number) => { x: number; z: number }
  /** 경로 위 위치에서 진행 방향(지도 좌표의 단위 벡터) */
  directionAt: (progress: number) => { x: number; z: number }
  toLatLng: (progress: number) => { lat: number; lng: number }
  match: (lat: number, lng: number) => RouteMatch
}

/**
 * 경로 위 위치에서 굽은 정도(1/m, 부호 있음: 진행 방향 기준 오른쪽으로 꺾이면 +). 앞뒤 window(m) 지점의
 * 진행 방향이 바뀐 각도를 그 거리로 나눕니다. 직선이면 0, 반지름 r인 원이면 1/r에 가깝습니다.
 */
export function turnRateAt(geo: RouteGeo, progress: number, window = 25) {
  const offset = window / geo.length
  const before = geo.directionAt(progress - offset)
  const after = geo.directionAt(progress + offset)
  const turn = Math.atan2(before.x * after.z - before.z * after.x, before.x * after.x + before.z * after.z)
  return turn / (2 * window)
}

/** 굽은 길을 이 속도(km/h)로 돌 때 이륜차가 눕는 각도(°): atan(v²κ / g) */
export function leanAngle(speedKmh: number, curvature: number) {
  const speed = speedKmh / 3.6
  return (Math.atan((speed * speed * Math.abs(curvature)) / 9.81) * 180) / Math.PI
}

/** 닫힌 경로(마지막 점 → 첫 점)를 길이 기준으로 다룹니다. */
export function createRouteGeo(route: Pick<RouteDefinition, 'path'>): RouteGeo {
  const points = route.path.map(([lat, lng]) => toLocal(lat, lng))
  const count = points.length
  /** cumulative[i]: 첫 점부터 i번째 점까지 거리, cumulative[count]: 한 바퀴 */
  const cumulative = [0]
  for (let i = 0; i < count; i += 1) {
    const a = points[i]!
    const b = points[(i + 1) % count]!
    cumulative.push(cumulative[i]! + Math.hypot(b.x - a.x, b.z - a.z))
  }
  const length = cumulative[count]!

  /** 위치가 들어 있는 구간(i번째 점 → 다음 점)과 그 구간 안의 비율 */
  const locate = (progress: number) => {
    const target = (((progress % 1) + 1) % 1) * length
    let low = 0
    let high = count - 1
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (cumulative[mid]! <= target) low = mid
      else high = mid - 1
    }
    const span = cumulative[low + 1]! - cumulative[low]!
    return { index: low, t: span === 0 ? 0 : (target - cumulative[low]!) / span }
  }

  const pointAt = (progress: number) => {
    const { index, t } = locate(progress)
    const a = points[index]!
    const b = points[(index + 1) % count]!
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
  }

  const directionAt = (progress: number) => {
    const { index } = locate(progress)
    const a = points[index]!
    const b = points[(index + 1) % count]!
    const d = Math.hypot(b.x - a.x, b.z - a.z) || 1
    return { x: (b.x - a.x) / d, z: (b.z - a.z) / d }
  }

  const match = (lat: number, lng: number): RouteMatch => {
    const p = toLocal(lat, lng)
    let best = { progress: 0, distance: Number.POSITIVE_INFINITY }
    for (let i = 0; i < count; i += 1) {
      const a = points[i]!
      const b = points[(i + 1) % count]!
      const dx = b.x - a.x
      const dz = b.z - a.z
      const span = dx * dx + dz * dz
      const t = span === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / span))
      const distance = Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z)
      if (distance < best.distance) best = { progress: ((cumulative[i]! + Math.sqrt(span) * t) / length) % 1, distance }
    }
    return best
  }

  return {
    length,
    pointAt,
    directionAt,
    toLatLng: (progress) => {
      const { x, z } = pointAt(progress)
      return fromLocal(x, z)
    },
    match,
  }
}
