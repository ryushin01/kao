import { CatmullRomCurve3, Vector3 } from 'three'
import type { RouteDefinition } from '../config/routes'

/**
 * 경로 곡선과 실제 좌표(위도·경도) 사이를 오갑니다. 관제 지도와 서버가 같은 곡선을 써야 위치가 맞습니다.
 * 이 파일은 Node에서도(scripts/live-demo.mjs) 그대로 불러오므로 타입만 가져오고 다른 모듈을 쓰지 않습니다.
 */

const SAMPLES = 512
const METERS_PER_DEGREE = 111_320

/** 관제 지도가 그리는 곡선(닫힌 centripetal Catmull-Rom, 지도 단위) */
export function routeCurve(route: RouteDefinition) {
  return new CatmullRomCurve3(
    route.points.map(([x, z]) => new Vector3(x, 0, z)),
    true,
    'centripetal',
  )
}

export interface RouteMatch {
  /** 경로 위 위치(0 이상 1 미만, 곡선 길이 기준) */
  progress: number
  /** 경로에서 떨어진 거리(m) */
  distance: number
}

export interface RouteGeo {
  toLatLng: (progress: number) => { lat: number; lng: number }
  match: (lat: number, lng: number) => RouteMatch
}

/**
 * 경로 모양을 실제 한 바퀴 길이(lengthKm)로 키워 경로 중심(route.geo)에 놓습니다.
 * 지도의 -z 방향을 북쪽으로 봅니다(지도를 위에서 볼 때 위쪽).
 */
export function createRouteGeo(route: RouteDefinition): RouteGeo {
  const curve = routeCurve(route)
  const meters = (route.lengthKm * 1000) / curve.getLength()
  const points = curve.getSpacedPoints(SAMPLES)
  const cx = route.points.reduce((sum, [x]) => sum + x, 0) / route.points.length
  const cz = route.points.reduce((sum, [, z]) => sum + z, 0) / route.points.length
  const cosLat = Math.cos((route.geo.lat * Math.PI) / 180)

  const toLatLng = (progress: number) => {
    const point = curve.getPointAt(((progress % 1) + 1) % 1)
    const east = (point.x - cx) * meters
    const north = -(point.z - cz) * meters
    return { lat: route.geo.lat + north / METERS_PER_DEGREE, lng: route.geo.lng + east / (METERS_PER_DEGREE * cosLat) }
  }

  const match = (lat: number, lng: number): RouteMatch => {
    // 위도·경도를 지도 단위로 바꾼 뒤, 촘촘히 나눈 곡선 조각마다 가장 가까운 점을 찾습니다.
    const x = cx + ((lng - route.geo.lng) * METERS_PER_DEGREE * cosLat) / meters
    const z = cz - ((lat - route.geo.lat) * METERS_PER_DEGREE) / meters
    let best = { progress: 0, distance: Number.POSITIVE_INFINITY }
    for (let i = 0; i < SAMPLES; i += 1) {
      const a = points[i]!
      const b = points[i + 1]!
      const dx = b.x - a.x
      const dz = b.z - a.z
      const length = dx * dx + dz * dz
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length))
      const distance = Math.hypot(a.x + dx * t - x, a.z + dz * t - z) * meters
      if (distance < best.distance) best = { progress: ((i + t) / SAMPLES) % 1, distance }
    }
    return best
  }

  return { toLatLng, match }
}
