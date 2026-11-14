import {
  AmbientLight,
  Box3,
  CircleGeometry,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  ShadowMaterial,
  SpotLight,
  Vector3,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { VehicleSnapshot } from '@shared/api'
import { applyStudioEnvironment, createStage, disposeObject } from '@shared/lib'
import { createMiniature, loadModelMiniature, preloadModel, rollWheels } from '@entities/vehicle'
import type { Miniature } from '@entities/vehicle'

export interface ShowcaseOptions {
  canvas: HTMLCanvasElement
  vehicle: Pick<VehicleSnapshot, 'modelId' | 'paint' | 'speed' | 'metrics'>
  playing: boolean
}

/** 턴테이블 위에 미니어처 한 대를 올려 돌려 봅니다. */
export function createShowcaseScene({ canvas, vehicle, playing }: ShowcaseOptions) {
  // 조명 환경 계산(GPU)보다 먼저 3D 모델 다운로드를 걸어 둡니다.
  preloadModel(vehicle.modelId)
  let speed = vehicle.speed
  let lean = 0
  let miniature: Miniature | null = null
  let currentModel = ''
  let disposed = false

  const stage = createStage({ canvas, fov: 30, far: 100, onFrame: (delta) => update(delta) })
  const { scene, camera, renderer } = stage
  renderer.shadowMap.enabled = true
  const disposeEnvironment = applyStudioEnvironment(renderer, scene, 0.7)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.enablePan = false
  controls.autoRotateSpeed = 1.4
  controls.minPolarAngle = Math.PI * 0.15
  controls.maxPolarAngle = Math.PI * 0.49
  controls.addEventListener('change', () => stage.invalidate())

  scene.add(new AmbientLight('#ffffff', 0.25))
  const key = new SpotLight('#ffffff', 60, 30, Math.PI / 5, 0.5)
  key.position.set(3, 7, 4)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  scene.add(key)
  const rim = new DirectionalLight('#ff3020', 1.8)
  rim.position.set(-6, 3, -5)
  scene.add(rim)

  // 턴테이블: 그림자 받이 + 진홍 고리
  const floor = new Mesh(new CircleGeometry(4, 64), new ShadowMaterial({ opacity: 0.55 }))
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)
  const plate = new Mesh(new CircleGeometry(3.2, 96), new MeshStandardMaterial({ color: '#0a0606', roughness: 0.85, metalness: 0.1 }))
  plate.rotation.x = -Math.PI / 2
  plate.position.y = -0.005
  scene.add(plate)
  const ring = new Mesh(new RingGeometry(3.2, 3.26, 128), new MeshBasicMaterial({ color: '#8b0000' }))
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.002
  scene.add(ring)

  function frameCamera(length: number) {
    // 미니어처 전체가 화면에 들어오도록 경계 상자로 거리를 정합니다.
    const bounds = new Box3()
    if (miniature) bounds.setFromObject(miniature.root)
    const size = bounds.getSize(new Vector3())
    const center = bounds.getCenter(new Vector3())
    const radius = Math.max(size.length() / 2, 0.6)
    const fit = radius / Math.sin(((camera.fov * Math.PI) / 180) / 2)
    const distance = fit * 0.82
    const direction = new Vector3(0.78, 0.36, 0.92).normalize()
    controls.target.copy(center)
    camera.position.copy(center).addScaledVector(direction, distance)
    controls.minDistance = distance * 0.45
    controls.maxDistance = distance * 2
    const turntable = Math.max(1, length * 0.62)
    plate.scale.setScalar(turntable / 3.2)
    ring.scale.setScalar(turntable / 3.2)
    floor.scale.setScalar(turntable / 3.2)
    controls.update()
  }

  function mount(next: Miniature) {
    if (miniature) {
      scene.remove(miniature.root)
      disposeObject(miniature.root)
    }
    miniature = next
    miniature.root.traverse((object) => {
      if (object instanceof Mesh) object.castShadow = true
    })
    scene.add(miniature.root)
    frameCamera(miniature.length)
    stage.invalidate()
  }

  function setVehicle(next: ShowcaseOptions['vehicle']) {
    speed = next.speed
    lean = next.metrics.find((metric) => metric.key === 'lean')?.value ?? 0
    if (next.modelId !== currentModel) {
      const modelId = next.modelId
      currentModel = modelId
      // 직접 만든 모형을 먼저 보여 주고, 실제 3D 모델을 다 받으면 바꿉니다.
      mount(createMiniature(modelId, next.paint.hex))
      void loadModelMiniature(modelId, next.paint.hex).then((model) => {
        if (!disposed && model && currentModel === modelId) mount(model)
      })
    }
    stage.invalidate()
  }

  function update(delta: number) {
    if (miniature && playing) {
      rollWheels(miniature, Math.min(speed / 3.6, 6) * delta * 0.35)
      if (miniature.leanPivot) {
        const goal = (Math.min(lean, 50) * Math.PI) / 180 * 0.35
        miniature.leanPivot.rotation.x += (goal - miniature.leanPivot.rotation.x) * Math.min(1, delta * 2)
      }
    }
    controls.update(delta)
  }

  const rotateBy = (radians: number) => {
    const offset = camera.position.clone().sub(controls.target)
    offset.applyAxisAngle(new Vector3(0, 1, 0), radians)
    camera.position.copy(controls.target).add(offset)
    controls.update()
    stage.invalidate()
  }

  setVehicle(vehicle)
  controls.autoRotate = playing
  stage.setPlaying(playing)

  return {
    setVehicle,
    rotateBy,
    reset() {
      if (miniature) frameCamera(miniature.length)
      stage.invalidate()
    },
    setPlaying(next: boolean) {
      playing = next
      controls.autoRotate = next
      stage.setPlaying(next)
    },
    dispose() {
      disposed = true
      controls.dispose()
      disposeEnvironment()
      stage.dispose()
    },
  }
}

export type ShowcaseScene = ReturnType<typeof createShowcaseScene>
