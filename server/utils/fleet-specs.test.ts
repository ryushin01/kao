import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEMO_ACCOUNTS, FLEET_SIZE } from '../../src/shared/api/contract'
import { ROUTES } from '../../src/shared/config/routes'
import { VEHICLE_CATEGORIES } from '../../src/entities/vehicle/config/categories'
import { MODEL_ASSETS } from '../../src/entities/vehicle/config/model-assets'
import { VEHICLE_SPECS } from './fleet-specs'

/**
 * 분류마다 대표 모델 한 대가 관제 지도에서 달립니다. 분류를 더하면 등록 탈것·경로·회원 계정·지도용 모델을 함께 더해야
 * 이 검사를 통과합니다(소개 화면에만 있고 지도에서는 달리지 않는 분류가 생기지 않게).
 */
describe('등록 탈것(VEHICLE_SPECS)', () => {
  it('분류마다 대표 모델의 탈것이 한 대씩 있습니다', () => {
    for (const category of VEHICLE_CATEGORIES) {
      const registered = VEHICLE_SPECS.filter((vehicle) => vehicle.kind === category.kind)
      expect(registered.map((vehicle) => vehicle.modelId), category.label).toEqual([category.representative])
    }
    expect(VEHICLE_SPECS).toHaveLength(VEHICLE_CATEGORIES.length)
  })

  it('탈것마다 실제 도로 경로가 따로 있습니다', () => {
    const routeIds = VEHICLE_SPECS.map((vehicle) => vehicle.routeId)
    for (const routeId of routeIds) expect(ROUTES.some((route) => route.id === routeId), routeId).toBe(true)
    expect(new Set(routeIds).size).toBe(routeIds.length)
  })

  it('탈것마다 회원 계정이 하나씩 있고, 관제 요원은 모두를 봅니다', () => {
    expect(FLEET_SIZE).toBe(VEHICLE_SPECS.length)
    for (const vehicle of VEHICLE_SPECS) {
      const owners = DEMO_ACCOUNTS.filter((account) => account.role === 'member' && account.vehicleIds.includes(vehicle.id))
      expect(owners.map((account) => account.name), vehicle.id).toEqual([vehicle.member])
    }
  })

  it('실제 3D 모델이 있으면 관제 지도용 가벼운 버전도 있습니다', () => {
    for (const vehicle of VEHICLE_SPECS) {
      const asset = MODEL_ASSETS[vehicle.modelId]
      if (!asset) continue
      for (const url of [asset.url, asset.liteUrl]) expect(existsSync(`public${url}`), url).toBe(true)
    }
  })

  it('문제가 생길 수 있는 지표가 있고, 문제는 위험 기준을 넘어갑니다', () => {
    for (const vehicle of VEHICLE_SPECS) {
      const faulty = vehicle.metrics.filter((metric) => metric.fault)
      expect(faulty.length, vehicle.id).toBeGreaterThan(0)
      for (const metric of faulty) {
        const { target, actions } = metric.fault!
        // 늘 출렁이는 지표(기울기)는 평소 값(baseline)에서 문제만큼 더 밀려납니다(엔진의 crossingTime과 같은 셈).
        const limit = metric.crit ?? metric.warn!
        const sign = metric.direction === 'high' ? 1 : -1
        const reach = sign * (target - metric.nominal)
        const need = sign * (limit - (metric.baseline ?? metric.nominal))
        expect(need > 0 && reach >= need, `${vehicle.id} ${metric.key}`).toBe(true)
        expect(actions.length, `${vehicle.id} ${metric.key}`).toBeGreaterThan(0)
      }
    }
  })
})
