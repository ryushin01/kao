import { ACESFilmicToneMapping, Mesh, PerspectiveCamera, Scene, SRGBColorSpace, Timer, WebGLRenderer } from 'three'
import type { Material } from 'three'

export interface StageOptions {
  canvas: HTMLCanvasElement
  fov?: number
  near?: number
  far?: number
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

export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

export function disposeObject(root: { traverse: (fn: (object: unknown) => void) => void }) {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    object.geometry.dispose()
    const materials: Material[] = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) material.dispose()
  })
}

export function createStage({ canvas, fov = 35, near = 0.1, far = 400, onFrame }: StageOptions): Stage {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
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
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    invalidate()
  }

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
      intersection.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      disposeObject(scene)
      timer.dispose()
      renderer.dispose()
    },
  }
}
