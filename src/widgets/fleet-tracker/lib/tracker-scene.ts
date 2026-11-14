import { AmbientLight, DirectionalLight, Fog, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, RingGeometry, Vector2, Vector3 } from 'three'
import type { Object3D, PerspectiveCamera } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { FleetFrame, HealthState, VehicleSnapshot } from '@shared/api'
import { ROUTES, findRoute } from '@shared/config'
import { applyStudioEnvironment, createRouteGeo, createStage, disposeObject, leanAngle, toLocal, turnRateAt } from '@shared/lib'
import type { RouteGeo } from '@shared/lib'
import { createMiniature, loadModelMiniature, preloadModel, rollWheels } from '@entities/vehicle'
import type { Miniature } from '@entities/vehicle'
import { MAP_PLACES } from '../config/places'
import { buildSeoulMap, flatLayer, loadSeoulMap, ribbon } from './seoul-map'

/**
 * 서울 도심 관제 지도. OpenStreetMap 도로·한강 위를 미니어처가 실제 경로를 따라 달립니다.
 * 장면 좌표 1은 실제 200m이고, 미니어처는 멀리서도 보이도록 카메라 거리에 맞춰 화면 크기를 일정하게 둡니다.
 */

const HEALTH_COLORS: Record<HealthState, string> = {
  nominal: '#d8d2cc',
  warning: '#f5b544',
  critical: '#ff3b2b',
}

/** 장면 좌표 1이 나타내는 실제 거리(m) */
const METERS_PER_UNIT = 200
const toScene = (lat: number, lng: number) => {
  const { x, z } = toLocal(lat, lng)
  return new Vector3(x / METERS_PER_UNIT, 0, z / METERS_PER_UNIT)
}

/** 미니어처 길이 비율(세단 기준 1). 화면 크기는 카메라 거리로 정합니다. */
const MINIATURE_LENGTH = { sedan: 1, supercar: 1, superbike: 0.72, bicycle: 0.6 } as const
/** 이륜차가 지도 위 굽은 길에서 눕는 최대 각도(°). 급한 굽이에서는 속도를 줄인다고 봅니다. */
const MAX_LEAN = { superbike: 35, bicycle: 20 } as const
/** 세단 미니어처가 화면 높이에서 차지하는 비율. 가까이 따라갈수록(카메라 거리 8 미만) 키워 주행이 잘 보이게 합니다. */
const MINIATURE_SCREEN = 0.075
const FOV = 38
const TAN_HALF_FOV = Math.tan(((FOV / 2) * Math.PI) / 180)
const screenScale = (distance: number) => 2 * TAN_HALF_FOV * MINIATURE_SCREEN * (1 + 0.9 * Math.min(1, Math.max(0, (8 - distance) / 7)))

/** 네 경로가 모두 보이는 전체 보기(경로들의 가운데에서 남쪽 위로 비스듬히) */
const routeBounds = (() => {
  const points = ROUTES.flatMap((route) => route.path.map(([lat, lng]) => toScene(lat, lng)))
  const xs = points.map((p) => p.x)
  const zs = points.map((p) => p.z)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
})()
const OVERVIEW_TARGET = new Vector3((routeBounds.minX + routeBounds.maxX) / 2, 0, (routeBounds.minZ + routeBounds.maxZ) / 2 + 3.5)
/** 전체 보기 방향: 남쪽 위에서 비스듬히(약 51°) 내려다봅니다. */
const OVERVIEW_DIRECTION = new Vector3(0, 41, 33).normalize()
const OVERVIEW_PITCH = Math.atan2(41, 33)
const FOLLOW_OFFSET = new Vector3(-1.1, 1.3, 1.6)

/** 화면 비율에 맞춰 네 경로가 다 들어오는 카메라 거리(세로 화면이면 더 멀리) */
function overviewDistance(aspect: number) {
  const margin = 2.5
  const byWidth = ((routeBounds.maxX - routeBounds.minX) / 2 + margin) / (TAN_HALF_FOV * aspect * 0.92)
  const byDepth = (((routeBounds.maxZ - routeBounds.minZ) * Math.sin(OVERVIEW_PITCH)) / 2 + margin) / (TAN_HALF_FOV * 0.92)
  return Math.max(byWidth, byDepth)
}

interface Marker {
  id: string
  geo: RouteGeo
  lengthKm: number
  holder: Group
  miniature: Miniature
  ring: Mesh<RingGeometry, MeshBasicMaterial>
  shown: number
  target: number
  /** 실차 GPS 위치는 실제 속도로, 시뮬레이션 위치는 FleetFrame.timeScale배로 내다봅니다. */
  gps: boolean
  speed: number
  /** 이륜차가 눕는 최대 각도(°). 사륜차는 0 */
  maxLean: number
  health: HealthState
}

export interface TrackerSceneOptions {
  canvas: HTMLCanvasElement
  frame: FleetFrame
  playing: boolean
  /** 매 프레임 화면 좌표(픽셀)를 알려 줍니다. 이름표 위치에 씁니다(탈것은 id, 지명은 place:id). */
  onProject: (id: string, x: number, y: number, visible: boolean) => void
  onPick: (id: string) => void
}

const geos = new Map<string, RouteGeo>()
function geoFor(routeId: string) {
  let geo = geos.get(routeId)
  if (!geo) {
    geo = createRouteGeo(findRoute(routeId))
    geos.set(routeId, geo)
  }
  return geo
}

export function createTrackerScene({ canvas, frame, playing, onProject, onPick }: TrackerSceneOptions) {
  // 조명 환경 계산(GPU)보다 먼저 지도 데이터와 지도용 3D 모델 다운로드를 걸어 둡니다.
  const mapRequest = loadSeoulMap()
  for (const vehicle of frame.vehicles) preloadModel(vehicle.modelId, 'lite')
  let disposed = false
  let timeScale = frame.timeScale
  let followId: string | null = null
  const markers = new Map<string, Marker>()
  const projected = new Vector3()
  const previousTarget = new Vector3()
  const places = MAP_PLACES.map((place) => ({ id: `place:${place.id}`, position: toScene(place.lat, place.lng) }))

  const stage = createStage({
    canvas,
    fov: FOV,
    near: 0.05,
    far: 400,
    onFrame: (delta) => update(delta),
  })
  const { scene, camera, renderer } = stage
  const disposeEnvironment = applyStudioEnvironment(renderer, scene, 0.6)
  // 지도 끝이 툭 끊겨 보이지 않도록 멀리 있는 곳은 어둠에 묻습니다(거리는 전체 보기에 맞춰 정함).
  const fog = new Fog('#050303', 55, 120)
  scene.fog = fog

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 0.8
  controls.maxPolarAngle = Math.PI * 0.46
  controls.addEventListener('change', () => stage.invalidate())
  // 사용자가 시점을 움직이기 전까지는 화면 크기가 바뀌면 전체 보기를 다시 맞춥니다.
  let fittedAspect = 0
  controls.addEventListener('start', () => {
    fittedAspect = -1
  })

  function showOverview() {
    const distance = overviewDistance(camera.aspect)
    controls.target.copy(OVERVIEW_TARGET)
    camera.position.copy(OVERVIEW_TARGET).addScaledVector(OVERVIEW_DIRECTION, distance)
    controls.maxDistance = Math.max(80, distance * 1.4)
    fog.near = distance * 1.15
    fog.far = distance * 2.3
    fittedAspect = camera.aspect
    controls.update()
  }
  showOverview()

  scene.add(new AmbientLight('#ffffff', 0.35))
  const sun = new DirectionalLight('#ffffff', 1.6)
  sun.position.set(-12, 30, 18)
  scene.add(sun)
  const rim = new DirectionalLight('#ff4030', 1.1)
  rim.position.set(20, 8, -25)
  scene.add(rim)

  // 바닥: 지도 데이터를 받기 전에도 경로와 미니어처가 놓일 어두운 지면
  const ground = flatLayer(new PlaneGeometry(200, 200).rotateX(-Math.PI / 2), '#060404', -50)
  ground.position.copy(OVERVIEW_TARGET)
  scene.add(ground)

  // 서울 도로·한강·공원(OpenStreetMap). 받는 동안에는 경로만 보입니다.
  let seoul: Group | null = null
  void mapRequest.then((data) => {
    if (disposed || !data) return
    seoul = buildSeoulMap(data, METERS_PER_UNIT)
    scene.add(seoul)
    stage.invalidate()
  })

  // 경로: 어두운 진홍 띠 + 밝은 중앙선(도로 위에 겹쳐 그림). 겹치는 이음매가 얼룩지지 않게 둘 다 불투명합니다.
  const routeLayers = new Group()
  for (const route of ROUTES) {
    const line = route.path.flatMap(([lat, lng]) => {
      const { x, z } = toLocal(lat, lng)
      return [x, z]
    })
    routeLayers.add(flatLayer(ribbon([line], 70, METERS_PER_UNIT, true), '#4a0a07', -20))
    routeLayers.add(flatLayer(ribbon([line], 16, METERS_PER_UNIT, true), '#ff4a36', -19))
  }
  scene.add(routeLayers)

  function addMarker(vehicle: VehicleSnapshot) {
    const size = MINIATURE_LENGTH[vehicle.kind]
    const miniature = createMiniature(vehicle.modelId, vehicle.paint.hex)
    miniature.root.scale.setScalar(size / miniature.length)
    const holder = new Group()
    holder.add(miniature.root)
    holder.userData.vehicleId = vehicle.id
    const ring = new Mesh(
      new RingGeometry(size * 0.62, size * 0.7, 48),
      new MeshBasicMaterial({ color: HEALTH_COLORS[vehicle.health], transparent: true, opacity: 0.9 }),
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.02
    holder.add(ring)
    scene.add(holder)
    markers.set(vehicle.id, {
      id: vehicle.id,
      geo: geoFor(vehicle.routeId),
      lengthKm: findRoute(vehicle.routeId).lengthKm,
      holder,
      miniature,
      ring,
      shown: vehicle.mapProgress,
      target: vehicle.mapProgress,
      gps: vehicle.positionSource === 'gps',
      speed: vehicle.speed,
      maxLean: vehicle.kind === 'superbike' || vehicle.kind === 'bicycle' ? MAX_LEAN[vehicle.kind] : 0,
      health: vehicle.health,
    })

    // 실제 3D 모델을 다 받으면 직접 만든 모형과 바꿔 끼웁니다.
    void loadModelMiniature(vehicle.modelId, vehicle.paint.hex, 'lite').then((model) => {
      const marker = markers.get(vehicle.id)
      if (disposed || !model || !marker) return
      model.root.scale.setScalar(size / model.length)
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
      marker.target = vehicle.mapProgress
      marker.gps = vehicle.positionSource === 'gps'
      marker.speed = vehicle.speed
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
      const rate = ((marker.speed / 3600) * (marker.gps ? 1 : timeScale)) / marker.lengthKm
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
    const point = marker.geo.pointAt(u)
    const direction = marker.geo.directionAt(u)
    marker.holder.position.set(point.x / METERS_PER_UNIT, 0, point.z / METERS_PER_UNIT)
    marker.holder.rotation.y = Math.atan2(-direction.z, direction.x)
    // 멀리서도 보이도록 카메라와의 거리에 비례해 키웁니다(화면에서 늘 비슷한 크기).
    const distance = camera.position.distanceTo(marker.holder.position)
    marker.holder.scale.setScalar(distance * screenScale(distance))

    const pivot = marker.miniature.leanPivot
    if (pivot) {
      // 지도 위 굽은 길과 실제 속도로 눕는 각도(atan(v²κ/g))를 정하고, 굽은 쪽(곡선 안쪽)으로 기울입니다.
      // 지도는 빠르게 돌아도 각도는 실제 속도 기준이라, 직선에서는 서고 굽이에서만 눕습니다.
      const turn = turnRateAt(marker.geo, u)
      const angle = (Math.min(leanAngle(marker.speed, turn), marker.maxLean) * Math.PI) / 180
      pivot.rotation.x += ((Math.sign(turn) || 1) * angle - pivot.rotation.x) * (playing ? Math.min(1, delta * 4) : 1)
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

  function project(id: string, position: Vector3, lift: number) {
    projected.copy(position)
    projected.y += lift
    projected.project(camera)
    const visible = projected.z < 1 && Math.abs(projected.x) <= 1.1 && Math.abs(projected.y) <= 1.1
    onProject(id, ((projected.x + 1) / 2) * canvas.clientWidth, ((1 - projected.y) / 2) * canvas.clientHeight, visible)
  }

  function update(delta: number) {
    if (followId === null && fittedAspect > 0 && fittedAspect !== camera.aspect) showOverview()
    for (const marker of markers.values()) place(marker, delta)
    followCamera(delta)
    controls.update()
    for (const marker of markers.values()) project(marker.id, marker.holder.position, marker.holder.scale.x * 0.55)
    for (const item of places) project(item.id, item.position, 0)
  }

  function setFollow(id: string | null) {
    followId = id
    if (id === null) {
      showOverview()
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
      if (seoul) disposeObject(seoul)
      disposeObject(routeLayers)
      disposeObject(ground)
      stage.dispose()
    },
  }
}

export type TrackerScene = ReturnType<typeof createTrackerScene>
