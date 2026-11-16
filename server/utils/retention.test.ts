import { describe, expect, it } from 'vitest'
import { isPruneWindow } from './retention'

describe('isPruneWindow', () => {
  it('한국 시간 4시부터 10분 동안만 참입니다(5분 크론이 하루에 두 번 지나감)', () => {
    const kst = (hour: number, minute: number) => Date.UTC(2026, 10, 16, hour - 9, minute)
    expect(isPruneWindow(kst(4, 0))).toBe(true)
    expect(isPruneWindow(kst(4, 9))).toBe(true)
    expect(isPruneWindow(kst(4, 10))).toBe(false)
    expect(isPruneWindow(kst(3, 59))).toBe(false)
    expect(isPruneWindow(kst(16, 0))).toBe(false)
  })
})
