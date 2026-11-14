import { describe, expect, it } from 'vitest'
import { ROUTES } from '../config/routes'
import { createRouteGeo } from './route-geo'

describe('createRouteGeo', () => {
  it.each(ROUTES.map((route) => [route.id, route] as const))('%s: 경로 위 위치를 좌표로 바꿨다가 다시 맞추면 같은 위치가 나옵니다', (_, route) => {
    const geo = createRouteGeo(route)
    for (const progress of [0, 0.123, 0.5, 0.875, 0.999]) {
      const { lat, lng } = geo.toLatLng(progress)
      const matched = geo.match(lat, lng)
      const gap = Math.min(Math.abs(matched.progress - progress), 1 - Math.abs(matched.progress - progress))
      expect(gap).toBeLessThan(0.002)
      expect(matched.distance).toBeLessThan(1)
    }
  })

  it('한 바퀴를 따라가면 실제 길이(lengthKm)만큼 움직입니다', () => {
    const route = ROUTES.find((item) => item.id === 'circuit')!
    const geo = createRouteGeo(route)
    let total = 0
    let previous = geo.toLatLng(0)
    for (let i = 1; i <= 400; i += 1) {
      const next = geo.toLatLng(i / 400)
      const north = (next.lat - previous.lat) * 111_320
      const east = (next.lng - previous.lng) * 111_320 * Math.cos((route.geo.lat * Math.PI) / 180)
      total += Math.hypot(north, east)
      previous = next
    }
    expect(total / 1000).toBeCloseTo(route.lengthKm, 1)
  })

  it('경로에서 멀리 떨어진 좌표는 거리가 크게 나옵니다', () => {
    const route = ROUTES.find((item) => item.id === 'urban-loop')!
    const far = createRouteGeo(route).match(route.geo.lat + 0.05, route.geo.lng)
    expect(far.distance).toBeGreaterThan(1000)
  })
})
