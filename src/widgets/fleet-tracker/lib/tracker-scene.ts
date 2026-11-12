import {
  AmbientLight,
  CatmullRomCurve3,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three'
import type { Object3D, PerspectiveCamera } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { FleetFrame, HealthState, VehicleSnapshot } from '@shared/api'
import { ROUTES, findRoute } from '@shared/config'
import { applyStudioEnvironment, createStage, disposeObject } from '@shared/lib'
import { createMiniature, loadModelMiniature, rollWheels } from '@entities/vehicle'
import type { Miniature } from '@entities/vehicle'

const HEALTH_COLORS: Record<HealthState, string> = {
  nominal: '#d8d2cc',
  warning: '#f5b544',
  critical: '#ff3b2b',
}

/** 지도에서 보이는 미니어처 길이(지도 단위). 실제 크기를 그대로 쓰면 자전거가 보이지 않습니다. */
const MINIATURE_LENGTH = { sedan: 3.2, supercar: 3.2, superbike: 2.3, bicycle: 1.9 } as const

const OVERVIEW_CAMERA = new Vector3(0, 30, 31)
const OVERVIEW_TARGET = new Vector3(0, 0, 1.5)
const FOLLOW_OFFSET = new Vector3(-5.5, 5, 6.5)

interface Marker {
  id: string
  curve: CatmullRomCurve3
  lengthKm: number
  holder: Group
  miniature: Miniature
  ring: Mesh<RingGeometry, MeshBasicMaterial>
  shown: number
  target: number
  speed: number
  lean: number
  health: HealthState
}

export interface TrackerSceneOptions {
  canvas: HTMLCanvasElement
  frame: FleetFrame
  playing: boolean
  /** 매 프레임 화면 좌표(픽셀)를 알려 줍니다. 이름표 위치에 씁니다. */
  onProject: (id: string, x: number, y: number, visible: boolean) => void
  onPick: (id: string) => void
}

function curveFor(routeId: string) {
  const route = findRoute(routeId)
  return new CatmullRomCurve3(
    route.points.map(([x, z]) => new Vector3(x, 0, z)),
    true,
    'centripetal',
  )
}

export function createTrackerScene({ canvas, frame, playing, onProject, onPick }: TrackerSceneOptions) {
  let disposed = false
  let timeScale = frame.timeScale
  let followId: string | null = null
  const markers = new Map<string, Marker>()
  const projected = new Vector3()
  const tangent = new Vector3()
  const ahead = new Vector3()
  const previousTarget = new Vector3()

  const stage = createStage({
    canvas,
    fov: 38,
    far: 300,
    onFrame: (delta) => update(delta),
  })
  const { scene, camera, renderer } = stage
  const disposeEnvironment = applyStudioEnvironment(renderer, scene, 0.6)
  scene.fog = null

  camera.position.copy(OVERVIEW_CAMERA)
  const controls = new OrbitControls(camera, canvas)
  controls.target.copy(OVERVIEW_TARGET)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 4
  controls.maxDistance = 70
  controls.maxPolarAngle = Math.PI * 0.46
  controls.addEventListener('change', () => stage.invalidate())
  controls.update()

  scene.add(new AmbientLight('#ffffff', 0.35))
  const sun = new DirectionalLight('#ffffff', 1.6)
  sun.position.set(-12, 30, 18)
  scene.add(sun)
  const rim = new DirectionalLight('#ff4030', 1.1)
  rim.position.set(20, 8, -25)
  scene.add(rim)

  // 바닥과 격자
  const ground = new Mesh(new PlaneGeometry(140, 140), new MeshStandardMaterial({ color: '#050303', roughness: 1 }))
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.02
  scene.add(ground)
  const grid = new GridHelper(80, 40, new Color('#8b0000'), new Color('#2a0c0c'))
  grid.position.y = -0.01
  scene.add(grid)

  // 경로: 어두운 노면 띠 + 진홍 중앙선
  const roadMaterial = new MeshStandardMaterial({ color: '#141010', roughness: 0.85 })
  const lineMaterial = new MeshBasicMaterial({ color: '#b3100a' })
  for (const route of ROUTES) {
    const curve = curveFor(route.id)
    const road = new Mesh(new TubeGeometry(curve, 240, 0.55, 8, true), roadMaterial)
    road.scale.y = 0.04
    scene.add(road)
    const line = new Mesh(new TubeGeometry(curve, 240, 0.05, 6, true), lineMaterial)
    line.position.y = 0.03
    scene.add(line)
  }

  function addMarker(vehicle: VehicleSnapshot) {
    const curve = curveFor(vehicle.routeId)
    const miniature = createMiniature(vehicle.modelId, vehicle.paint.hex)
    const scale = MINIATURE_LENGTH[vehicle.kind] / miniature.length
    miniature.root.scale.setScalar(scale)
    const holder = new Group()
    holder.add(miniature.root)
    holder.userData.vehicleId = vehicle.id
    const ring = new Mesh(
      new RingGeometry(MINIATURE_LENGTH[vehicle.kind] * 0.62, MINIATURE_LENGTH[vehicle.kind] * 0.7, 48),
      new MeshBasicMaterial({ color: HEALTH_COLORS[vehicle.health], transparent: true, opacity: 0.9 }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.05
    holder.add(ring)
    scene.add(holder)
    markers.set(vehicle.id, {
      id: vehicle.id,
      curve,
      lengthKm: findRoute(vehicle.routeId).lengthKm,
      holder,
      miniature,
      ring,
      shown: vehicle.progress,
      target: vehicle.progress,
      speed: vehicle.speed,
      lean: 0,
      health: vehicle.health,
    })

    // 실제 3D 모델을 다 받으면 직접 만든 모형과 바꿔 끼웁니다.
    void loadModelMiniature(vehicle.modelId, vehicle.paint.hex, 'lite').then((model) => {
      const marker = markers.get(vehicle.id)
      if (disposed || !model || !marker) return
      model.root.scale.setScalar(MINIATURE_LENGTH[vehicle.kind] / model.length)
      holder.remove(marker.miniature.root)
      disposeObject(marker.miniature.root)
      holder.add(model.root)
      marker.miniature = model
      stage.invalidate()
    })
  }

  function setFrame(next: FleetFrame) {
    timeScale = next.timeScale
    for (const vehicle of next.vehicles) {
      if (!markers.has(vehicle.id)) addMarker(vehicle)
      const marker = markers.get(vehicle.id)!
      marker.target = vehicle.progress
      marker.speed = vehicle.speed
      marker.lean = vehicle.metrics.find((metric) => metric.key === 'lean')?.value ?? (vehicle.kind === 'bicycle' ? 8 : 0)
      if (marker.health !== vehicle.health) {
        marker.health = vehicle.health
        marker.ring.material.color.set(HEALTH_COLORS[vehicle.health])
      }
    }
    stage.invalidate()
  }

  function place(marker: Marker, delta: number) {
    if (playing && delta > 0) {
      // 속도로 앞으로 내다보고, 서버 위치와의 차이는 천천히 메웁니다.
      const rate = ((marker.speed / 3600) * timeScale) / marker.lengthKm
      marker.shown += rate * delta
      let gap = marker.target - marker.shown
      if (gap > 0.5) gap -= 1
      if (gap < -0.5) gap += 1
      marker.shown += gap * Math.min(1, delta * 2)
      marker.shown = ((marker.shown % 1) + 1) % 1
      rollWheels(marker.miniature, Math.min(marker.speed / 3.6, 9) * delta)
    } else if (!playing) {
      marker.shown = marker.target
    }

    const u = marker.shown
    marker.curve.getPointAt(u, marker.holder.position)
    marker.curve.getTangentAt(u, tangent)
    marker.holder.rotation.y = Math.atan2(-tangent.z, tangent.x)

    const pivot = marker.miniature.leanPivot
    if (pivot) {
      // 굽은 쪽(곡선 안쪽)으로 기울입니다.
      marker.curve.getTangentAt((u + 0.01) % 1, ahead)
      const turn = tangent.x * ahead.z - tangent.z * ahead.x
      const side = Math.sign(turn) || 1
      const angle = (Math.min(marker.lean, 62) * Math.PI) / 180
      pivot.rotation.x += (side * angle - pivot.rotation.x) * (playing ? Math.min(1, delta * 4) : 1)
    }

    if (marker.health === 'critical' && playing) {
      marker.ring.material.opacity = 0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 260))
    } else {
      marker.ring.material.opacity = 0.9
    }
  }

  function followCamera(delta: number) {
    const marker = followId ? markers.get(followId) : null
    if (!marker) return
    // 대상이 움직인 만큼 카메라도 옮겨, 사용자가 돌려 둔 각도를 유지합니다.
    previousTarget.copy(controls.target)
    const smoothing = playing ? Math.min(1, delta * 4) : 1
    controls.target.lerp(marker.holder.position, smoothing)
    camera.position.add(controls.target.clone().sub(previousTarget))
  }

  function update(delta: number) {
    for (const marker of markers.values()) place(marker, delta)
    followCamera(delta)
    controls.update()
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    for (const marker of markers.values()) {
      projected.copy(marker.holder.position)
      projected.y += 1.8
      projected.project(camera)
      const visible = projected.z < 1 && Math.abs(projected.x) <= 1.1 && Math.abs(projected.y) <= 1.1
      onProject(marker.id, ((projected.x + 1) / 2) * width, ((1 - projected.y) / 2) * height, visible)
    }
  }

  function setFollow(id: string | null) {
    followId = id
    if (id === null) {
      controls.target.copy(OVERVIEW_TARGET)
      camera.position.copy(OVERVIEW_CAMERA)
    } else {
      const marker = markers.get(id)
      if (marker) {
        controls.target.copy(marker.holder.position)
        camera.position.copy(marker.holder.position).add(FOLLOW_OFFSET)
      }
    }
    stage.invalidate()
  }

  // 지도에서 탈것을 누르면 그 탈것을 따라갑니다(끌어서 돌린 경우는 제외).
  const raycaster = new Raycaster()
  const pointer = new Vector2()
  let downAt: { x: number; y: number } | null = null
  const onPointerDown = (event: PointerEvent) => {
    downAt = { x: event.clientX, y: event.clientY }
  }
  const onPointerUp = (event: PointerEvent) => {
    if (!downAt || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 5) return
    const rect = canvas.getBoundingClientRect()
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
    raycaster.setFromCamera(pointer, camera as PerspectiveCamera)
    const hit = raycaster.intersectObjects([...markers.values()].map((m) => m.holder), true)[0]
    let node: Object3D | null = hit?.object ?? null
    while (node && !node.userData.vehicleId) node = node.parent
    if (node) onPick(node.userData.vehicleId as string)
  }
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerup', onPointerUp)

  setFrame(frame)
  stage.setPlaying(playing)

  return {
    setFrame,
    setFollow,
    setPlaying(next: boolean) {
      playing = next
      stage.setPlaying(next)
    },
    dispose() {
      disposed = true
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      controls.dispose()
      disposeEnvironment()
      stage.dispose()
    },
  }
}

export type TrackerScene = ReturnType<typeof createTrackerScene>
