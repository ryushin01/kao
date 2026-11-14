/**
 * 화면 전체에 프래그먼트 셰이더 하나만 그리는 작은 WebGL 무대입니다.
 * 소개 화면 첫 로딩에서 three.js(약 600KB)를 받지 않으려고 three.js 대신 WebGL을 직접 씁니다.
 */

const VERTEX_SHADER = /* glsl */ `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

type UniformValue = number | readonly [number, number]

export interface ShaderCanvasOptions {
  canvas: HTMLCanvasElement
  fragmentShader: string
  /** 렌더 해상도 배율 상한. 브라우저 배율이 바뀔 때마다 기기 배율과 비교해 다시 적용합니다. */
  maxPixelRatio?: number
  /** 그리기 직전마다 부릅니다. delta는 초 단위입니다. uResolution은 무대가 넣습니다. */
  onFrame?: (delta: number) => void
}

export interface ShaderCanvas {
  setUniform: (name: string, value: UniformValue) => void
  /** true면 매 프레임 그리고, false면 invalidate()를 부를 때만 그립니다. */
  setPlaying: (playing: boolean) => void
  invalidate: () => void
  dispose: () => void
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  console.warn('[event-horizon] 셰이더 컴파일 실패:', gl.getShaderInfoLog(shader))
  gl.deleteShader(shader)
  return null
}

/** WebGL을 쓸 수 없거나 셰이더를 만들지 못하면 null을 돌려줍니다(화면은 대체 배경을 씁니다). */
export function createShaderCanvas({ canvas, fragmentShader, maxPixelRatio = 1, onFrame }: ShaderCanvasOptions): ShaderCanvas | null {
  const attributes: WebGLContextAttributes = { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' }
  const gl = (canvas.getContext('webgl2', attributes) ?? canvas.getContext('webgl', attributes)) as WebGLRenderingContext | null
  if (!gl) return null

  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentShader)
  const program = gl.createProgram()
  if (!vertex || !fragment || !program) return null
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[event-horizon] 셰이더 연결 실패:', gl.getProgramInfoLog(program))
    return null
  }
  gl.useProgram(program)

  // 화면을 덮는 삼각형 하나(사각형 두 개보다 경계선 겹침이 없음)
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'aPosition')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

  const uniforms = new Map<string, UniformValue>()
  const locations = new Map<string, WebGLUniformLocation | null>()
  const locationOf = (name: string) => {
    if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name))
    return locations.get(name) ?? null
  }

  let playing = true
  let visible = true
  let lost = false
  let frameId = 0
  let pendingRender = false
  let last = performance.now()

  const render = () => {
    if (lost) return
    const now = performance.now()
    const delta = Math.min((now - last) / 1000, 0.1)
    last = now
    onFrame?.(delta)
    for (const [name, value] of uniforms) {
      const location = locationOf(name)
      if (!location) continue
      if (typeof value === 'number') gl.uniform1f(location, value)
      else gl.uniform2f(location, value[0], value[1])
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  const loop = () => {
    frameId = 0
    render()
    if (playing && visible) frameId = requestAnimationFrame(loop)
  }

  const start = () => {
    if (frameId === 0 && playing && visible) {
      last = performance.now()
      frameId = requestAnimationFrame(loop)
    }
  }

  const invalidate = () => {
    if (frameId !== 0 || pendingRender) return
    pendingRender = true
    requestAnimationFrame(() => {
      pendingRender = false
      render()
    })
  }

  const resize = () => {
    const parent = canvas.parentElement
    if (!parent) return
    const ratio = Math.min(window.devicePixelRatio || 1, maxPixelRatio)
    const width = Math.max(1, Math.round(parent.clientWidth * ratio))
    const height = Math.max(1, Math.round(parent.clientHeight * ratio))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    gl.viewport(0, 0, width, height)
    uniforms.set('uResolution', [width, height])
    invalidate()
  }

  // 크기는 그대로인데 기기 배율만 바뀌는 경우(배율이 다른 모니터로 창 이동)도 따라갑니다.
  let ratioQuery: MediaQueryList | null = null
  const watchPixelRatio = () => {
    ratioQuery?.removeEventListener('change', onRatioChange)
    ratioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    ratioQuery.addEventListener('change', onRatioChange)
  }
  function onRatioChange() {
    resize()
    watchPixelRatio()
  }
  watchPixelRatio()

  const resizeObserver = new ResizeObserver(resize)
  if (canvas.parentElement) resizeObserver.observe(canvas.parentElement)
  resize()

  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true
    if (visible) start()
  })
  intersection.observe(canvas)

  const onVisibility = () => {
    visible = document.visibilityState === 'visible'
    if (visible) start()
  }
  document.addEventListener('visibilitychange', onVisibility)

  // 브라우저가 컨텍스트를 거둬 가면 그리기를 멈춥니다(화면에는 마지막 그림이 남습니다).
  const onLost = (event: Event) => {
    event.preventDefault()
    lost = true
    if (frameId) cancelAnimationFrame(frameId)
    frameId = 0
  }
  canvas.addEventListener('webglcontextlost', onLost)

  start()

  return {
    setUniform(name, value) {
      uniforms.set(name, value)
    },
    setPlaying(next) {
      playing = next
      if (playing) start()
      else invalidate()
    },
    invalidate,
    dispose() {
      if (frameId) cancelAnimationFrame(frameId)
      frameId = 0
      resizeObserver.disconnect()
      intersection.disconnect()
      ratioQuery?.removeEventListener('change', onRatioChange)
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', onLost)
      if (!lost) {
        gl.deleteBuffer(buffer)
        gl.deleteProgram(program)
        gl.deleteShader(vertex)
        gl.deleteShader(fragment)
      }
      // 컨텍스트를 바로 돌려줍니다(브라우저가 한 번에 열어 두는 WebGL 컨텍스트 수에는 한도가 있습니다).
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
