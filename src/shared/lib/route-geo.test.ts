import { describe, expect, it } from 'vitest'
import { ROUTES } from '../config/routes'
import { createRouteGeo, fromLocal, leanAngle, toLocal, turnRateAt } from './route-geo'

describe('route-geo', () => {
  it('위도·경도와 지도 좌표(m)를 오가면 같은 곳으로 돌아옵니다', () => {
    const { x, z } = toLocal(37.5663, 126.9779)
    expect(z).toBeLessThan(0) // 지도 중심보다 북쪽이면 -z
    const back = fromLocal(x, z)
    expect(back.lat).toBeCloseTo(37.5663, 6)
    expect(back.lng).toBeCloseTo(126.9779, 6)
  })

  it.each(ROUTES.map((route) => [route.id, route] as const))('%s: 경로 위 위치를 좌표로 바꿨다가 다시 맞추면 같은 위치가 나옵니다', (_, route) => {
    const geo = createRouteGeo(route)
    for (const progress of [0, 0.123, 0.5, 0.875, 0.999]) {
      const { lat, lng } = geo.toLatLng(progress)
      const matched = geo.match(lat, lng)
      const gap = Math.min(Math.abs(matched.progress - progress), 1 - Math.abs(matched.progress - progress))
      expect(gap * geo.length).toBeLessThan(1)
      expect(matched.distance).toBeLessThan(0.5)
    }
  })

  it.each(ROUTES.map((route) => [route.id, route] as const))('%s: 한 바퀴 길이가 lengthKm과 같고 실제 서울 도심 안에 있습니다', (_, route) => {
    const geo = createRouteGeo(route)
    expect(geo.length / 1000).toBeCloseTo(route.lengthKm, 2)
    for (const [lat, lng] of route.path) {
      expect(lat).toBeGreaterThan(37.49)
      expect(lat).toBeLessThan(37.59)
      expect(lng).toBeGreaterThan(126.89)
      expect(lng).toBeLessThan(127.03)
    }
  })

  it('진행 방향은 단위 벡터이고 경로에서 멀리 떨어진 좌표는 거리가 크게 나옵니다', () => {
    const route = ROUTES.find((item) => item.id === 'downtown')!
    const geo = createRouteGeo(route)
    const direction = geo.directionAt(0.3)
    expect(Math.hypot(direction.x, direction.z)).toBeCloseTo(1, 6)
    const [lat, lng] = route.path[0]!
    expect(geo.match(lat + 0.02, lng).distance).toBeGreaterThan(1500)
  })
  it('굽은 정도는 반지름 r인 원에서 1/r이고 직선에서 0이며, 기울기는 atan(v²κ/g)입니다', () => {
    // 지도 중심 둘레 반지름 200m 원(시계 방향)과, 남북으로 곧은 긴 고리
    const circle = Array.from({ length: 180 }, (_, i) => {
      const angle = (i / 180) * Math.PI * 2
      return fromLocal(Math.cos(angle) * 200, Math.sin(angle) * 200)
    }).map(({ lat, lng }) => [lat, lng] as const)
    const round = createRouteGeo({ path: circle })
    expect(Math.abs(turnRateAt(round, 0.3))).toBeCloseTo(1 / 200, 3)
    const straight = createRouteGeo({ path: [[37.53, 126.96], [37.56, 126.96], [37.56, 126.9601], [37.53, 126.9601]] })
    expect(turnRateAt(straight, 0.2)).toBeCloseTo(0, 6)
    // 시속 50km로 반지름 30m를 돌면 약 33°
    expect(leanAngle(50, 1 / 30)).toBeCloseTo(33.3, 0)
    expect(leanAngle(50, 0)).toBe(0)
  })
})
