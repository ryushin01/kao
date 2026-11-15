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

  it('제한 시간이 지나면 글꼴 정의를 꺼서, 글꼴이 늦게 와도 글자가 바뀌지 않는다', async () => {
    vi.useFakeTimers()
    document.documentElement.lang = 'ko'
    const faces = document.createElement('style')
    faces.id = 'font-faces'
    document.head.append(faces)
    let finish: (value: unknown) => void = () => {}
    stubFonts(() => new Promise((resolve) => (finish = resolve)))
    run()
    vi.advanceTimersByTime(FONT_LOADER_TIMEOUT_MS)
    expect(state()).toBe('ready')
    expect(faces.disabled).toBe(true)
    finish([])
    await vi.runAllTimersAsync()
    expect(faces.disabled).toBe(true)
    faces.remove()
  })
})
