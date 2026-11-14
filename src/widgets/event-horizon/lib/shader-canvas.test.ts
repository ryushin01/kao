import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createShaderCanvas } from './shader-canvas'

/** 셰이더 컴파일·연결 결과만 흉내 내는 가짜 WebGL 컨텍스트 */
function fakeGl(options: { failLink?: () => boolean } = {}) {
  let programs = 0
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    STATIC_DRAW: 6,
    FLOAT: 7,
    TRIANGLES: 8,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({ index: (programs += 1) })),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => !options.failLink?.()),
    getProgramInfoLog: vi.fn(() => 'link error'),
    useProgram: vi.fn(),
    deleteProgram: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    deleteBuffer: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn((program: { index: number }, name: string) => ({ program: program.index, name })),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    viewport: vi.fn(),
    drawArrays: vi.fn(),
    getExtension: vi.fn(() => ({ loseContext: vi.fn() })),
  }
  return gl
}

function setup(gl: ReturnType<typeof fakeGl>, onFailure = vi.fn()) {
  const parent = document.createElement('div')
  const canvas = document.createElement('canvas')
  parent.append(canvas)
  document.body.append(parent)
  canvas.getContext = vi.fn(() => gl) as unknown as HTMLCanvasElement['getContext']
  const stage = createShaderCanvas({ canvas, fragmentShader: 'void main() {}', onFailure })!
  return { canvas, stage, onFailure }
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))

beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('createShaderCanvas', () => {
  it('컨텍스트를 되찾으면 프로그램·버퍼·uniform 위치를 다시 만들어 이어 그립니다', async () => {
    const gl = fakeGl()
    const { canvas, stage } = setup(gl)
    stage.setUniform('uTime', 1)
    await nextFrame()
    expect(gl.uniform1f).toHaveBeenLastCalledWith({ program: 1, name: 'uTime' }, 1)

    const lost = new Event('webglcontextlost', { cancelable: true })
    canvas.dispatchEvent(lost)
    expect(lost.defaultPrevented).toBe(true)
    const draws = gl.drawArrays.mock.calls.length
    await nextFrame()
    expect(gl.drawArrays.mock.calls.length).toBe(draws)

    canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(gl.createProgram).toHaveBeenCalledTimes(2)
    stage.setUniform('uTime', 2)
    await nextFrame()
    await nextFrame()
    expect(gl.drawArrays.mock.calls.length).toBeGreaterThan(draws)
    expect(gl.uniform1f).toHaveBeenLastCalledWith({ program: 2, name: 'uTime' }, 2)
    stage.dispose()
  })

  it('되찾은 컨텍스트에서 셰이더를 다시 만들지 못하면 대체 배경으로 바꾸도록 알립니다', () => {
    let restored = false
    const gl = fakeGl({ failLink: () => restored })
    const { canvas, onFailure } = setup(gl)
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    restored = true
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    expect(onFailure).toHaveBeenCalledTimes(1)
  })
})
