import { ACESFilmicToneMapping, Mesh, PerspectiveCamera, Scene, SRGBColorSpace, Timer, WebGLRenderer, WebGLRenderTarget } from 'three'
import type { Camera, Material, MeshPhysicalMaterial, Object3D } from 'three'

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
  /**
   * scene 위에 겹쳐 그리는 장면. 깊이만 지운 뒤 그리므로 scene의 물체(관제 지도의 건물 등)에 가려지지 않습니다.
   * 비어 있으면 그리지 않습니다.
   */
  overlay: Scene
  camera: PerspectiveCamera
  renderer: WebGLRenderer
  /** true면 매 프레임 그리고, false면 invalidate()를 부를 때만 그립니다. */
  setPlaying: (playing: boolean) => void
  invalidate: () => void
  /**
   * promise가 끝날 때까지 그리지 않습니다. 셰이더를 미리 컴파일하는 동안(precompile) 먼저 그려 버리면
   * 그 자리에서 컴파일이 끝나기를 기다리며 메인 스레드가 멈추므로, 첫 화면을 컴파일 뒤로 미룰 때 씁니다.
   */
  hold: (promise: Promise<unknown>) => void
  dispose: () => void
}

/** 다음 작업(task)으로 넘어가 메인 스레드에 다른 일(입력 처리, 그리기)이 끼어들 틈을 줍니다. */
export const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const materialsOf = (object: Object3D): Material[] => {
  const material = (object as Mesh).material as Material | Material[] | undefined
  return material ? (Array.isArray(material) ? material : [material]) : []
}

function drawablesOf(root: Object3D) {
  const objects: Object3D[] = []
  root.traverse((object) => {
    if ((object as Mesh).isMesh || 'isPoints' in object || 'isLine' in object || 'isSprite' in object) objects.push(object)
  })
  return objects
}

const hasTransmission = (objects: Object3D[]) =>
  objects.some((object) => materialsOf(object).some((material) => ((material as MeshPhysicalMaterial).transmission ?? 0) > 0))

/** 물체마다 compileAsync를 걸고(target이 있으면 그 렌더 타깃에 그릴 때의 셰이더로), 8ms마다 메인 스레드에 틈을 줍니다. */
async function compileEach(renderer: WebGLRenderer, objects: Object3D[], camera: Camera, targetScene: Scene, target: WebGLRenderTarget | null) {
  const pending: Array<Promise<unknown>> = []
  let sliceStart = performance.now()
  for (const object of objects) {
    // 렌더 타깃은 이 한 번의 컴파일 동안만 걸어 둡니다(틈에 다른 그리기가 끼어들어도 화면에 그리도록).
    const previous = renderer.getRenderTarget()
    if (target) renderer.setRenderTarget(target)
    pending.push(renderer.compileAsync(object, camera, targetScene))
    if (target) renderer.setRenderTarget(previous)
    if (performance.now() - sliceStart > 8) {
      await nextTask()
      sliceStart = performance.now()
    }
  }
  await Promise.all(pending)
}

/**
 * root 안 물체들의 셰이더를 그리기 전에 미리 컴파일합니다. three.js는 처음 그릴 때 셰이더를 컴파일하고 끝날 때까지 기다려
 * 메인 스레드가 수백 ms 멈추는데, compileAsync는 브라우저가 KHR_parallel_shader_compile을 지원하면 기다리지 않고 완료를
 * 확인합니다. 셰이더 문자열을 만드는 일도 물체마다 몇 ms씩 걸려, 8ms마다 메인 스레드에 틈을 줍니다.
 * targetScene은 물체를 넣을 장면입니다(조명·안개·반사 환경이 셰이더에 들어갑니다). 끝난 뒤에 장면에 넣어야 멈추지 않습니다.
 *
 * 투과(유리) 재질이 있으면 three.js는 불투명 물체를 톤 매핑 없이 선형 색으로 렌더 타깃에 한 번 더 그립니다(투과 패스).
 * 이 셰이더는 compile이 만들지 않으므로, 렌더 타깃을 건 상태로 root와 장면의 물체를 한 번 더 컴파일합니다.
 * 두 단계를 차례로 기다려야 재질마다 두 셰이더가 모두 준비됩니다(compileAsync는 재질의 마지막 셰이더만 확인).
 */
export async function precompile(renderer: WebGLRenderer, root: Object3D, camera: Camera, targetScene: Scene) {
  const objects = drawablesOf(root)
  await compileEach(renderer, objects, camera, targetScene, null)
  const sceneObjects = root === targetScene ? [] : drawablesOf(targetScene)
  if (!hasTransmission(objects) && !hasTransmission(sceneObjects)) return
  const target = new WebGLRenderTarget(1, 1)
  await compileEach(renderer, [...new Set([...objects, ...sceneObjects])], camera, targetScene, target)
  target.dispose()
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
  const overlay = new Scene()
  const camera = new PerspectiveCamera(fov, 1, near, far)
  const timer = new Timer()

  let playing = true
  let visible = true
  let frameId = 0
  let pendingRender = false
  let holds = 0
  let disposed = false

  const render = () => {
    if (holds > 0 || disposed) return
    timer.update()
    const delta = Math.min(timer.getDelta(), 0.1)
    onFrame?.(delta, timer.getElapsed())
    renderer.render(scene, camera)
    if (overlay.children.length > 0) {
      renderer.autoClear = false
      renderer.clearDepth()
      renderer.render(overlay, camera)
      renderer.autoClear = true
    }
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
    overlay,
    camera,
    renderer,
    setPlaying(next) {
      playing = next
      if (playing) start()
      else invalidate()
    },
    invalidate,
    hold(promise) {
      holds += 1
      void promise
        .catch(() => undefined)
        .finally(() => {
          holds -= 1
          if (holds > 0 || disposed) return
          start()
          invalidate()
        })
    },
    dispose() {
      disposed = true
      if (frameId) cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      ratioQuery?.removeEventListener('change', onRatioChange)
      intersection.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      disposeObject(scene)
      disposeObject(overlay)
      timer.dispose()
      renderer.dispose()
      // dispose()만으로는 브라우저가 WebGL 컨텍스트를 바로 돌려주지 않아, 화면을 오가면 컨텍스트 수 한도에 걸립니다.
      renderer.forceContextLoss()
    },
  }
}
