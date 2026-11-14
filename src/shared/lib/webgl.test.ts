import { afterEach, describe, expect, it, vi } from 'vitest'

/** 모듈이 결과를 기억하므로 경우마다 새로 불러옵니다. */
async function load() {
  vi.resetModules()
  return import('./webgl')
}

describe('isWebGLAvailable', () => {
  afterEach(() => vi.restoreAllMocks())

  it('확인에 쓴 WebGL 컨텍스트는 바로 놓아 주고, 한 번만 확인한다', async () => {
    const loseContext = vi.fn()
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ getExtension: () => ({ loseContext }) } as unknown as WebGL2RenderingContext)
    const { isWebGLAvailable } = await load()

    expect(isWebGLAvailable()).toBe(true)
    expect(isWebGLAvailable()).toBe(true)
    expect(loseContext).toHaveBeenCalledTimes(1)
    expect(getContext).toHaveBeenCalledTimes(1)
  })

  it('WebGL을 쓸 수 없으면 false', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const { isWebGLAvailable } = await load()

    expect(isWebGLAvailable()).toBe(false)
  })
})
