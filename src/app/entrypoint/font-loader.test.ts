import { afterEach, describe, expect, it, vi } from 'vitest'
import { FONT_LOADER_SCRIPT, FONT_LOADER_TIMEOUT_MS } from './font-loader'

const run = () => new Function(FONT_LOADER_SCRIPT)()
const state = () => document.documentElement.dataset.fonts
const stubFonts = (load: unknown) =>
  Object.defineProperty(document, 'fonts', { value: { load }, configurable: true })

describe('font-loader', () => {
  afterEach(() => {
    delete document.documentElement.dataset.fonts
    vi.useRealTimers()
  })

  it('서울알림체 세 굵기를 다 받으면 화면을 연다', async () => {
    const load = vi.fn().mockResolvedValue([])
    stubFonts(load)
    run()
    expect(state()).toBe('loading')
    await vi.waitFor(() => expect(state()).toBe('ready'))
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('글꼴이 늦으면 제한 시간 뒤에 연다', () => {
    vi.useFakeTimers()
    stubFonts(() => new Promise(() => {}))
    run()
    vi.advanceTimersByTime(FONT_LOADER_TIMEOUT_MS - 1)
    expect(state()).toBe('loading')
    vi.advanceTimersByTime(1)
    expect(state()).toBe('ready')
  })
})
