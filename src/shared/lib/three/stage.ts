import { ACESFilmicToneMapping, Mesh, PerspectiveCamera, Scene, SRGBColorSpace, Timer, WebGLRenderer } from 'three'
import type { Material } from 'three'

export interface StageOptions {
  canvas: HTMLCanvasElement
  fov?: number
  near?: number
  far?: number
  /** 렌더 해상도 배율 상한. 브라우저 배율이 바뀔 때마다 기기 배율과 비교해 다시 적용합니다. */
  maxPixelRatio?: number
  /** 프레임마다 부릅니다. delta는 초 단위입니다. */
  onFrame?: (delta: number, elapsed: number) => void
}

export interface Stage {
  scene: Scene
  camera: PerspectiveCamera
  renderer: WebGLRenderer
  /** true면 매 프레임 그리고, false면 invalidate()를 부를 때만 그립니다. */
  setPlaying: (playing: boolean) => void
  invalidate: () => void
  dispose: () => void
}

export function disposeObject(root: { traverse: (fn: (object: unknown) => void) => void }) {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    object.geometry.dispose()
    const materials: Material[] = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) material.dispose()
  })
}

export function createStage({ canvas, fov = 35, near = 0.1, far = 400, maxPixelRatio = 2, onFrame }: StageOptions): Stage {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05

  const scene = new Scene()
  const camera = new PerspectiveCamera(fov, 1, near, far)
  const timer = new Timer()

  let playing = true
  let visible = true
  let frameId = 0
  let pendingRender = false

  const render = () => {
    timer.update()
    const delta = Math.min(timer.getDelta(), 0.1)
    onFrame?.(delta, timer.getElapsed())
    renderer.render(scene, camera)
  }

  const loop = () => {
    frameId = 0
    render()
    if (playing && visible) frameId = requestAnimationFrame(loop)
  }

  const start = () => {
    if (frameId === 0 && playing && visible) {
      timer.update()
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
    const width = Math.max(1, parent.clientWidth)
    const height = Math.max(1, parent.clientHeight)
    // 브라우저 배율을 바꾸면 요소 크기도 바뀌어 여기로 들어오므로, 기기 배율을 다시 읽습니다.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio))
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
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

  start()

  return {
    scene,
    camera,
    renderer,
    setPlaying(next) {
      playing = next
      if (playing) start()
      else invalidate()
    },
    invalidate,
    dispose() {
      if (frameId) cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      ratioQuery?.removeEventListener('change', onRatioChange)
      intersection.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      disposeObject(scene)
      timer.dispose()
      renderer.dispose()
      // dispose()만으로는 브라우저가 WebGL 컨텍스트를 바로 돌려주지 않아, 화면을 오가면 컨텍스트 수 한도에 걸립니다.
      renderer.forceContextLoss()
    },
  }
}
