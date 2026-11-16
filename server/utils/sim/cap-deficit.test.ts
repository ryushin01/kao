import { describe, expect, it } from 'vitest'
import { CAP_STEP, createCapDeficit } from './cap-deficit'
import type { CapIntegrand, CapWindow } from './cap-deficit'

const DURATION = 90_000

/** 0.14.0까지의 적분: 부를 때마다 첫 구간부터 time까지 다시 적분합니다(같은 값이 나와야 하는 기준). */
function reference(all: readonly CapWindow[], { pace, base, speedAt }: CapIntegrand, time: number) {
  const windows = all.filter((window) => window.start < time)
  let deficit = 0
  let at = windows[0]?.start ?? time
  for (const window of windows) {
    at = Math.max(at, window.start)
    const until = Math.min(window.end, time)
    for (; at < until; at += CAP_STEP) {
      const dt = Math.min(CAP_STEP, until - at) / 1000
      const cap = Math.min(...windows.filter((item) => item.start <= at && at < item.end).map((item) => item.cap))
      const m = pace(at)
      const speed = speedAt(base(at) - deficit)
      const rate = speed * m > cap ? cap / speed : m
      deficit += (m - rate) * dt
    }
  }
  return deficit
}

function seeded(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 사인파 배수와 위치마다 다른 속도 표(굽이·신호를 흉내 낸 톱니)
const integrand: CapIntegrand = {
  pace: (at) => 0.85 + 0.15 * Math.sin(at / 41_000),
  base: (at) => 0.85 * (at / 1000) - (0.15 * 41) * Math.cos(at / 41_000),
  speedAt: (effective) => {
    const phase = ((effective % 300) + 300) % 300
    return phase < 20 ? 0.3 + phase * 0.4 : 4 + 18 * Math.abs(Math.sin(phase / 37))
  },
}

function randomWindows(rand: () => number, count: number, from: number) {
  const windows: CapWindow[] = []
  let at = from
  for (let i = 0; i < count; i += 1) {
    // 겹치는 구간, 같은 시각, 떨어진 구간을 섞습니다.
    const roll = rand()
    at += roll < 0.35 ? Math.floor(rand() * DURATION) : roll < 0.45 ? 0 : Math.floor(rand() * 20 * 60_000)
    windows.push({ start: at, end: at + DURATION, cap: rand() < 0.5 ? 30 / 3.6 : 48 / 3.6 })
  }
  return windows.sort((a, b) => a.start - b.start)
}

describe('createCapDeficit', () => {
  it('제한이 없거나 아직 시작 전이면 0입니다', () => {
    expect(createCapDeficit([], integrand)(1_000_000)).toBe(0)
    const deficit = createCapDeficit([{ start: 5_000_000, end: 5_000_000 + DURATION, cap: 8 }], integrand)
    expect(deficit(4_000_000)).toBe(0)
    expect(deficit(5_000_000)).toBe(0)
  })

  it('처음부터 다시 적분한 값과 비트 단위로 같습니다(겹침·같은 시각·구간 안·구간 끝)', () => {
    const rand = seeded(7)
    for (let round = 0; round < 6; round += 1) {
      const windows = randomWindows(rand, 4 + round * 5, 1_000_000_000 + round * 7_777)
      const deficit = createCapDeficit(windows, integrand)
      const times = [
        ...windows.flatMap((window) => [window.start, window.start + 1, window.start + 1_234, window.end - 1, window.end, window.end + 250]),
        windows.at(-1)!.end + 3_600_000,
      ]
      // 시각 순서와 상관없이 같아야 합니다(기억한 구간 결과를 앞뒤로 오가며 씀).
      for (const time of [...times, ...[...times].reverse()]) {
        expect(deficit(time)).toBe(reference(windows, integrand, time))
      }
    }
  })

  it('지난 구간은 한 번만 적분합니다', () => {
    let calls = 0
    const counted: CapIntegrand = { ...integrand, pace: (at) => (calls += 1, integrand.pace(at)) }
    const windows = randomWindows(seeded(3), 40, 2_000_000_000)
    const deficit = createCapDeficit(windows, counted)
    const end = windows.at(-1)!.end + 60_000
    deficit(end)
    const first = calls
    for (let i = 0; i < 100; i += 1) deficit(end + i * 500)
    // 다시 부를 때는 지난 구간을 적분하지 않습니다.
    expect(calls).toBe(first)
  })
})
