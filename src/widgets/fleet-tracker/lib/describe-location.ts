import { MAP_PLACES } from '../config/places'

const DIRECTIONS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'] as const
const METERS_PER_DEGREE = 111_195

/**
 * 실제 위치(위도·경도)를 관제 지도에 이름이 뜨는 곳 가운데 가장 가까운 곳의 방향과 거리로 나타냅니다.
 * 예: '반포대교 남동쪽 약 3.2km'. 3D 지도를 보지 못할 때(WebGL 미지원, 화면 낭독기) 표에서 위치를 알 수 있게 합니다.
 */
export function describeLocation(lat: number, lng: number): string {
  let nearest = { name: '', distance: Infinity, east: 0, north: 0 }
  for (const place of MAP_PLACES) {
    const east = (lng - place.lng) * METERS_PER_DEGREE * Math.cos((place.lat * Math.PI) / 180)
    const north = (lat - place.lat) * METERS_PER_DEGREE
    const distance = Math.hypot(east, north)
    if (distance < nearest.distance) nearest = { name: place.name, distance, east, north }
  }
  if (nearest.distance < 50) return `${nearest.name} 부근`
  const bearing = ((Math.atan2(nearest.east, nearest.north) * 180) / Math.PI + 360) % 360
  const direction = DIRECTIONS[Math.round(bearing / 45) % DIRECTIONS.length]
  const distance = nearest.distance < 1000 ? `${Math.round(nearest.distance / 50) * 50}m` : `${(nearest.distance / 1000).toFixed(1)}km`
  return `${nearest.name} ${direction}쪽 약 ${distance}`
}
