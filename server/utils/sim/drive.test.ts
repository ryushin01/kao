import { describe, expect, it } from 'vitest'
import { fromLocal } from '../../../src/shared/lib/route-geo'
import { createDriveProfile } from './drive'
import type { DriveOptions } from './drive'

/** 한 변 1km 정사각형 닫힌 경로(지도 좌표 m에서 위도·경도로). 모퉁이 4곳은 90° 굽이입니다. */
const square = (speedLimits: ReadonlyArray<readonly [number, number]> = [[0, 60]], signals: number[] = []) => ({
  path: [
    [0, 0],
    [1000, 0],
    [1000, 1000],
    [0, 1000],
  ].map(([x, z]) => {
    const { lat, lng } = fromLocal(x!, z!)
    return [lat, lng] as const
  }),
  speedLimits,
  signals,
})
const options: DriveOptions = { topSpeed: 50, handling: { accel: 2, decel: 3, lateral: 2 }, dwell: () => 30 }

/** 한 바퀴를 유효 시간 0.1초 간격으로 따라가며 위치·속도를 모읍니다. */
function sample(profile: ReturnType<typeof createDriveProfile>) {
  const samples: Array<{ e: number; distance: number; speed: number }> = []
  for (let e = 0; e < profile.lapTime; e += 0.1) samples.push({ e, ...profile.at(e) })
  return samples
}
const near = (samples: ReturnType<typeof sample>, distance: number) =>
  samples.reduce((best, item) => (Math.abs(item.distance - distance) < Math.abs(best.distance - distance) ? item : best))

describe('createDriveProfile', () => {
  it('곧은 길에서는 제한속도와 탈것 최고 속도 가운데 낮은 쪽으로, 모퉁이에서는 √(횡가속 × 반지름)까지 줄여 달립니다', () => {
    const profile = createDriveProfile(square(), options)
    const samples = sample(profile)
    expect(profile.length).toBeCloseTo(4000, -1)
    // 변 가운데: 제한 60이지만 탈것 최고 50
    expect(near(samples, 500).speed * 3.6).toBeCloseTo(50, 1)
    // 모퉁이(1000m): 앞뒤 25m에서 90° 꺾임 → 곡률 π/2/50, 속도 √(2 × 50 / (π/2)) ≈ 8m/s ≈ 29km/h
    expect(near(samples, 1000).speed * 3.6).toBeLessThan(30)
    expect(near(samples, 1000).speed * 3.6).toBeGreaterThan(20)
  })

  it('구간별 제한속도를 지킵니다', () => {
    const profile = createDriveProfile(square([[0, 60], [0.5, 30]]), { ...options, topSpeed: 80 })
    const samples = sample(profile)
    expect(near(samples, 500).speed * 3.6).toBeCloseTo(60, 1)
    // 뒤쪽 절반(2000m~)은 30km/h를 넘지 않습니다.
    for (const item of samples.filter((s) => s.distance > 2005)) expect(item.speed * 3.6).toBeLessThanOrEqual(30 + 1e-6)
  })

  it('속도는 가속·감속 한계 안에서만 바뀝니다(v² 차이 ≤ 2 × 가속도 × 거리)', () => {
    const samples = sample(createDriveProfile(square(), options))
    for (let i = 1; i < samples.length; i += 1) {
      const a = samples[i - 1]!
      const b = samples[i]!
      const ds = b.distance - a.distance
      if (ds <= 0) continue
      expect(b.speed ** 2 - a.speed ** 2).toBeLessThanOrEqual(2 * options.handling.accel * ds + 0.5)
      expect(a.speed ** 2 - b.speed ** 2).toBeLessThanOrEqual(2 * options.handling.decel * ds + 0.5)
    }
  })

  it('녹색 신호(정차 0초)에서는 서지 않고 지나갑니다', () => {
    const plain = createDriveProfile(square(), options)
    const green = createDriveProfile(square([[0, 60]], [0.375]), { ...options, dwell: () => 0 })
    expect(green.lapTime).toBeCloseTo(plain.lapTime, 6)
    expect(near(sample(green), 1500).speed * 3.6).toBeCloseTo(50, 1)
  })

  it('신호에서는 서서 정차 시간만큼 위치가 멈추고, 위치는 뒤로 가지 않습니다', () => {
    const plain = createDriveProfile(square(), options)
    const stopping = createDriveProfile(square([[0, 60]], [0.375]), options)
    // 정차 30초에, 서고 출발하느라 늦어진 시간이 더해집니다.
    expect(stopping.lapTime - plain.lapTime).toBeGreaterThan(30)
    const samples = sample(stopping)
    const still = samples.filter((item) => item.speed === 0)
    expect(still.length * 0.1).toBeCloseTo(30, 0)
    // 서 있는 곳은 신호 자리(한 바퀴의 37.5% = 1500m)
    for (const item of still) expect(item.distance).toBeCloseTo(1500, -1)
    for (let i = 1; i < samples.length; i += 1) expect(samples[i]!.distance).toBeGreaterThanOrEqual(samples[i - 1]!.distance)
    // 한 바퀴 끝에서 길이에 닿습니다.
    expect(stopping.at(stopping.lapTime).distance).toBeCloseTo(stopping.length, 3)
  })
})
