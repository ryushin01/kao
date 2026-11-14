import type { RouteDefinition } from '../../../src/shared/config/routes'
import { createRouteGeo, turnRateAt } from '../../../src/shared/lib/route-geo'

/**
 * 경로 위치마다 낼 수 있는 속도(주행 속도 표)와, 그 속도로 한 바퀴를 도는 시간표.
 *
 * 시뮬레이션은 시간의 순수 함수여야 해서(서버리스: 어느 인스턴스든 같은 시각이면 같은 상태), 속도가 위치에 따라 바뀌어도
 * 어느 시각이든 위치를 바로 구할 수 있게 '유효 시간'을 씁니다. 차는 위치 s에서 v(s) × m(t)로 달립니다(v는 이 표,
 * m은 교통 흐름에 따른 배수). ds / v(s) = m(t) dt이므로, 시간표 τ(s) = ∫ ds / v(s)와 유효 시간 E(t) = ∫ m dt가
 * 같습니다. E(t)는 사인파의 적분이라 식으로 바로 구하고, 위치는 시간표에서 τ⁻¹(E mod 한 바퀴 시간)으로 찾습니다.
 * 신호에서는 시간표가 정차 시간만큼 건너뛰어, 그동안 위치가 멈춥니다.
 */

export interface Handling {
  /** 가속(m/s²) */
  accel: number
  /** 감속(m/s²) */
  decel: number
  /** 굽은 길에서 견디는 횡가속(m/s²). 반지름 r인 굽이는 √(횡가속 × r)까지 냅니다. */
  lateral: number
}

export interface DriveOptions {
  /** 탈것이 내는 최고 속도(km/h). 제한속도가 더 높아도 이보다 빨리 달리지 않습니다. */
  topSpeed: number
  handling: Handling
  /** 신호마다 서는 시간(초, 유효 시간). 신호 순서(0부터)로 정합니다. */
  dwell: (index: number) => number
}

export interface DriveProfile {
  /** 한 바퀴 길이(m) */
  length: number
  /** 한 바퀴 시간(유효 시간 초, 신호 정차 포함) */
  lapTime: number
  /** 유효 시간 e(0 이상 lapTime 미만)의 위치(m)와 그곳의 속도 표 값(m/s, 정차 중이면 0) */
  at: (e: number) => { distance: number; speed: number }
}

/** 속도 표 간격(m) */
const STEP = 5
/** 시간표에서 속도가 이보다 낮으면 이 값으로 셉니다(m/s). 신호 앞 정차 점의 0 때문에 시간이 무한대가 되지 않게. */
const CREEP = 0.3

export function createDriveProfile(route: Pick<RouteDefinition, 'path' | 'speedLimits' | 'signals'>, options: DriveOptions): DriveProfile {
  const geo = createRouteGeo(route)
  const length = geo.length
  const count = Math.max(8, Math.round(length / STEP))
  const step = length / count
  const { accel, decel, lateral } = options.handling

  // 1. 제한속도(탈것 최고 속도까지)와 굽이: 앞뒤 25m 진행 방향 차이로 구한 곡률 κ에서 √(횡가속 / κ)
  const speed = new Float64Array(count)
  let zone = 0
  for (let i = 0; i < count; i += 1) {
    const u = i / count
    while (zone + 1 < route.speedLimits.length && route.speedLimits[zone + 1]![0] <= u) zone += 1
    const legal = route.speedLimits[zone]?.[1] ?? options.topSpeed
    speed[i] = Math.min(legal, options.topSpeed) / 3.6
    const curvature = Math.abs(turnRateAt(geo, u))
    if (curvature > 1e-4) speed[i] = Math.min(speed[i]!, Math.sqrt(lateral / curvature))
  }

  // 2. 빨간 신호(정차 시간이 있는 신호)에서는 섭니다. 녹색(0초)은 서지 않고 지나갑니다.
  const stops = new Map<number, number>()
  route.signals.forEach((at, index) => {
    const dwell = Math.max(0, options.dwell(index))
    if (dwell > 0) stops.set(Math.round(at * count) % count, dwell)
  })
  for (const i of stops.keys()) speed[i] = 0

  // 3. 가감속 한계: 앞으로 가며 가속, 거꾸로 가며 감속을 제한합니다. 닫힌 경로라 두 바퀴 돌려 이음매도 맞춥니다.
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < count; i += 1) {
      const next = (i + 1) % count
      speed[next] = Math.min(speed[next]!, Math.sqrt(speed[i]! ** 2 + 2 * accel * step))
    }
    for (let i = count - 1; i >= 0; i -= 1) {
      const next = (i + 1) % count
      speed[i] = Math.min(speed[i]!, Math.sqrt(speed[next]! ** 2 + 2 * decel * step))
    }
  }

  // 4. 시간표: 점 사이는 등가속으로 보고(시간 = 2 × 거리 / (앞 속도 + 뒤 속도)), 신호에서는 정차 시간만큼 위치를 멈춥니다.
  const distances: number[] = [0]
  const times: number[] = [0]
  /** 시간표 칸이 속도 표의 어느 점에서 시작하는지(정차 칸은 -1) */
  const from: number[] = []
  let time = 0
  for (let i = 0; i < count; i += 1) {
    const dwell = stops.get(i)
    if (dwell !== undefined) {
      time += dwell
      distances.push(i * step)
      times.push(time)
      from.push(-1)
    }
    time += (2 * step) / Math.max(speed[i]! + speed[(i + 1) % count]!, 2 * CREEP)
    distances.push((i + 1) * step)
    times.push(time)
    from.push(i)
  }

  const at = (e: number) => {
    const target = Math.min(Math.max(e, 0), time)
    let low = 0
    let high = times.length - 2
    while (low < high) {
      const mid = (low + high + 1) >> 1
      if (times[mid]! <= target) low = mid
      else high = mid - 1
    }
    const i = from[low]!
    if (i < 0) return { distance: distances[low]!, speed: 0 }
    // 칸 안은 등가속 운동입니다: 걸린 시간 τ에서 거리 v₀τ + aτ²/2, 속도 v₀ + aτ(칸 끝에서 정확히 v₁·칸 길이에 닿음).
    const span = times[low + 1]! - times[low]!
    const elapsed = Math.min(Math.max(target - times[low]!, 0), span)
    const v0 = speed[i]!
    const v1 = speed[(i + 1) % count]!
    if (v0 + v1 < 2 * CREEP) return { distance: distances[low]! + (span > 0 ? (step * elapsed) / span : 0), speed: CREEP }
    const acceleration = span > 0 ? (v1 - v0) / span : 0
    return { distance: distances[low]! + v0 * elapsed + (acceleration * elapsed * elapsed) / 2, speed: v0 + acceleration * elapsed }
  }

  return { length, lapTime: time, at }
}
