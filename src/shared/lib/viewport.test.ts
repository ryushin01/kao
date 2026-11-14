import { afterEach, describe, expect, it, vi } from 'vitest'
import { whenNearViewport } from './viewport'

type Callback = (entries: Array<{ isIntersecting: boolean }>) => void

describe('whenNearViewport', () => {
  const original = globalThis.IntersectionObserver
  afterEach(() => {
    globalThis.IntersectionObserver = original
  })

  function mockObserver() {
    const instance = { callback: null as Callback | null, options: null as IntersectionObserverInit | null, disconnect: vi.fn(), observe: vi.fn() }
    globalThis.IntersectionObserver = vi.fn(function (this: unknown, callback: Callback, options: IntersectionObserverInit) {
      instance.callback = callback
      instance.options = options
      return { observe: instance.observe, disconnect: instance.disconnect }
    }) as unknown as typeof IntersectionObserver
    return instance
  }

  it('화면 가까이 들어올 때 한 번만 부르고 관찰을 멈춥니다', () => {
    const observer = mockObserver()
    const callback = vi.fn()
    whenNearViewport(document.createElement('div'), callback)
    expect(observer.options?.rootMargin).toBe('300px 0px')

    observer.callback!([{ isIntersecting: false }])
    expect(callback).not.toHaveBeenCalled()
    observer.callback!([{ isIntersecting: true }])
    expect(callback).toHaveBeenCalledTimes(1)
    expect(observer.disconnect).toHaveBeenCalled()
  })

  it('돌려준 함수로 취소하면 관찰을 멈춥니다', () => {
    const observer = mockObserver()
    const stop = whenNearViewport(document.createElement('div'), vi.fn())
    stop()
    expect(observer.disconnect).toHaveBeenCalled()
  })

  it('IntersectionObserver가 없으면 바로 부릅니다', () => {
    // @ts-expect-error 없는 환경을 흉내 냅니다.
    delete globalThis.IntersectionObserver
    const callback = vi.fn()
    whenNearViewport(document.createElement('div'), callback)
    expect(callback).toHaveBeenCalledTimes(1)
  })
})
