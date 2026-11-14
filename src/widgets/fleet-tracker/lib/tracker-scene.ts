import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Fog,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  Vector2,
  Vector3,
} from 'three'
import type { Object3D, PerspectiveCamera } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { FleetFrame, HealthState, VehicleSnapshot } from '@shared/api'
import { ROUTES, findRoute } from '@shared/config'
import { applyStudioEnvironment, createRouteGeo, createStage, disposeObject, leanAngle, nextTask, precompile, toLocal, turnRateAt } from '@shared/lib'
import type { RouteGeo } from '@shared/lib'
import { createMiniature, loadModelMiniature, preloadModel, rollWheels } from '@entities/vehicle'
import type { Miniature } from '@entities/vehicle'
import { MAP_PLACES } from '../config/places'
import type { LabelSize, ProjectedPoint } from './label-layout'
import { buildSeoulMap, edgeFade, flatLayer, loadSeoulMap, ribbon } from './seoul-map'

/**
 * 서울 도심 관제 지도. OpenStreetMap 도로·한강·높은 건물 사이를 미니어처가 실제 경로를 따라 달립니다.
 * 장면 좌표 1은 실제 200m이고, 미니어처는 멀리서도 보이도록 카메라 거리에 맞춰 화면 크기를 일정하게 둡니다.
 * 미니어처·상태 고리·주행 꼬리는 지도 위에 겹쳐 그리는 장면(stage.overlay)에 두어 건물에 가려지지 않습니다.
 */

const HEALTH_COLORS: Record<HealthState, string> = {
  nominal: '#d8d2cc',
  warning: '#f5b544',
  critical: '#ff3b2b',
}

/** 주행 꼬리 색: 상태 색을 밝게 해 붉은 경로 위에서도 보이게 합니다. */
const TRAIL_COLORS: Record<HealthState, string> = {
  nominal: '#f2ece6',
  warning: '#ffd58a',
  critical: '#ffb2a8',
}

/** 경로 색: 평소, 따라가는 탈것의 경로(강조), 다른 탈것을 따라갈 때 나머지 경로(흐리게) */
const ROUTE_STYLE = {
  normal: { band: '#4a0a07', line: '#ff4a36', arrows: '#ffb3a6' },
  focus: { band: '#5e0d09', line: '#ff4a36', arrows: '#ffe0da' },
  dim: { band: '#2b1311', line: '#6a2820', arrows: '#6a2820' },
} as const
/** 진행 방향 화살표(V자) 간격·길이·폭·선 굵기(m) */
const ARROW = { spacing: 220, length: 22, width: 34, stroke: 8 } as const
/** 바닥(지도 밖 지면)과 지도 끝을 묻는 색 */
const GROUND_COLOR = '#060404'
/** 지도 끝에서 바닥색으로 흐려지는 너비(m) */
const EDGE_FADE = 3000
/** 주행 꼬리의 점 수. 꼬리는 미니어처 뒤끝부터 미니어처 길이 × 속도(km/h) / 20(최대 3배)만큼입니다. */
const TRAIL_SAMPLES = 24
const TRAIL_MAX_ALPHA = 0.7

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
/** 따라가기 카메라 위치(탈것 기준). 약 45° 위에서 내려다봐 높은 건물에 덜 가립니다. */
const FOLLOW_OFFSET = new Vector3(-1, 1.65, 1.35)

/** 화면 비율에 맞춰 네 경로가 다 들어오는 카메라 거리(세로 화면이면 더 멀리) */
function overviewDistance(aspect: number) {
  const margin = 2.5
  const byWidth = ((routeBounds.maxX - routeBounds.minX) / 2 + margin) / (TAN_HALF_FOV * aspect * 0.92)
  const byDepth = (((routeBounds.maxZ - routeBounds.minZ) * Math.sin(OVERVIEW_PITCH)) / 2 + margin) / (TAN_HALF_FOV * 0.92)
  return Math.max(byWidth, byDepth)
}

interface Marker {
  id: string
  routeId: string
  geo: RouteGeo
  lengthKm: number
  holder: Group
  miniature: Miniature
  ring: Mesh<RingGeometry, MeshBasicMaterial>
  /** 지나온 길에 남는 꼬리(지도 좌표 그대로, holder 밖) */
  trail: Mesh<BufferGeometry, MeshBasicMaterial>
  /** 미니어처 길이 비율(MINIATURE_LENGTH) */
  bodyLength: number
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
  /** 매 프레임 탈것과 지명의 화면 좌표와 캔버스 크기(px)를 한꺼번에 알려 줍니다(이름표를 서로 겹치지 않게 놓는 데 씀). */
  onProject: (points: ProjectedPoint[], view: LabelSize) => void
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

/** 경로를 따라 ARROW.spacing마다 진행 방향(경로 점 순서)을 가리키는 V자 선들 */
function arrowLines(geo: RouteGeo) {
  const count = Math.max(1, Math.round(geo.length / ARROW.spacing))
  const lines: number[][] = []
  for (let i = 0; i < count; i += 1) {
    const u = (i + 0.5) / count
    const p = geo.pointAt(u)
    const d = geo.directionAt(u)
    const back = { x: p.x - (d.x * ARROW.length) / 2, z: p.z - (d.z * ARROW.length) / 2 }
    const side = { x: (-d.z * ARROW.width) / 2, z: (d.x * ARROW.width) / 2 }
    lines.push([back.x + side.x, back.z + side.z, p.x + (d.x * ARROW.length) / 2, p.z + (d.z * ARROW.length) / 2, back.x - side.x, back.z - side.z])
  }
  return lines
}

/** 주행 꼬리 메시: 점마다 양옆 꼭짓점 두 개, 색은 상태 색(재질) × 꼭짓점 투명도 */
function createTrail() {
  const geometry = new BufferGeometry()
  const positions = new BufferAttribute(new Float32Array(TRAIL_SAMPLES * 2 * 3), 3)
  positions.setUsage(DynamicDrawUsage)
  const colors = new Float32Array(TRAIL_SAMPLES * 2 * 4).fill(1)
  const index: number[] = []
  for (let i = 0; i < TRAIL_SAMPLES; i += 1) {
    // 꼬리 끝(0)은 투명하고 탈것 쪽으로 갈수록 진해집니다.
    const alpha = TRAIL_MAX_ALPHA * (i / (TRAIL_SAMPLES - 1)) ** 1.6
    colors[i * 8 + 3] = alpha
    colors[i * 8 + 7] = alpha
    if (i < TRAIL_SAMPLES - 1) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 2, i * 2 + 1, i * 2 + 3)
  }
  geometry.setAttribute('position', positions)
  geometry.setAttribute('color', new BufferAttribute(colors, 4))
  geometry.setIndex(index)
  const mesh = new Mesh(
    geometry,
    new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide }),
  )
  // 매 프레임 모양이 바뀌어 화면 밖 판정(경계 구)을 쓰지 않습니다.
  mesh.frustumCulled = false
  mesh.renderOrder = -1
  return mesh
}

export function createTrackerScene({ canvas, frame, playing, onProject, onPick }: TrackerSceneOptions) {
  // 조명 환경 계산(GPU)보다 먼저 지도 데이터(워커에서 도형까지 만듦)와 지도용 3D 모델 다운로드를 걸어 둡니다.
  const mapRequest = loadSeoulMap(METERS_PER_UNIT)
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
  const { scene, overlay, camera, renderer } = stage
  // 지도 레이어와 건물은 조명 없이 칠한 색(MeshBasicMaterial)이라, 조명과 반사 환경은 미니어처가 있는 overlay에만 둡니다.
  // 반사 환경(조명 환경 계산)은 아래 prepare()에서 따로 만듭니다.
  let disposeEnvironment = () => {}
  // 멀리 있는 곳은 어둠에 묻습니다(거리는 전체 보기에 맞춰 정함). 지도 끝은 edgeFade가 따로 흐립니다.
  const fog = new Fog('#050303', 55, 120)
  scene.fog = fog
  overlay.fog = fog

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

  overlay.add(new AmbientLight('#ffffff', 0.35))
  // 건물 벽 색(map-geometry의 SUN_DIRECTION·RIM_DIRECTION)도 이 두 조명 방향에 맞춰 칠합니다.
  const sun = new DirectionalLight('#ffffff', 1.6)
  sun.position.set(-12, 30, 18)
  overlay.add(sun)
  const rim = new DirectionalLight('#ff4030', 1.1)
  rim.position.set(20, 8, -25)
  overlay.add(rim)

  // 바닥: 지도 데이터를 받기 전에도 경로와 미니어처가 놓일 어두운 지면
  const ground = flatLayer(new PlaneGeometry(200, 200).rotateX(-Math.PI / 2), GROUND_COLOR, -50)
  ground.position.copy(OVERVIEW_TARGET)
  scene.add(ground)

  // 서울 도로·한강·공원·높은 건물(OpenStreetMap). 받는 동안에는 경로만 보이고, 셰이더를 미리 컴파일한 뒤 넣습니다.
  let seoul: Group | null = null
  let fade: ReturnType<typeof edgeFade> | null = null
  void mapRequest.then(async (layers) => {
    if (disposed || !layers) return
    const map = buildSeoulMap(layers)
    const edge = edgeFade(layers.bounds, EDGE_FADE, METERS_PER_UNIT, GROUND_COLOR)
    map.add(edge.mesh)
    // 미리 컴파일하지 못해도 넣습니다(그러면 처음 그릴 때 컴파일합니다).
    await precompile(renderer, map, camera, scene, { cancelled: () => disposed, hold: stage.hold }).catch(() => undefined)
    if (disposed) {
      disposeObject(map)
      edge.dispose()
      return
    }
    seoul = map
    fade = edge
    scene.add(map)
    stage.invalidate()
  })

  // 경로: 어두운 진홍 띠 + 밝은 중앙선 + 진행 방향 V자(도로 위에 겹쳐 그림). 겹치는 이음매가 얼룩지지 않게 모두 불투명합니다.
  const routeLayers = new Group()
  const routeMeshes = new Map<string, Record<keyof (typeof ROUTE_STYLE)['normal'], Mesh<BufferGeometry, MeshBasicMaterial>>>()
  for (const route of ROUTES) {
    const line = route.path.flatMap(([lat, lng]) => {
      const { x, z } = toLocal(lat, lng)
      return [x, z]
    })
    const meshes = {
      band: flatLayer(ribbon([line], 70, METERS_PER_UNIT, true), ROUTE_STYLE.normal.band, -20),
      line: flatLayer(ribbon([line], 16, METERS_PER_UNIT, true), ROUTE_STYLE.normal.line, -19),
      arrows: flatLayer(ribbon(arrowLines(geoFor(route.id)), ARROW.stroke, METERS_PER_UNIT), ROUTE_STYLE.normal.arrows, -18),
    }
    routeLayers.add(meshes.band, meshes.line, meshes.arrows)
    routeMeshes.set(route.id, meshes)
  }
  scene.add(routeLayers)

  /** 따라가는 탈것의 경로를 밝히고 나머지는 흐리게 합니다(null이면 모두 평소대로). 강조한 경로는 다른 경로 위에 그립니다. */
  function emphasize(routeId: string | null) {
    for (const [id, meshes] of routeMeshes) {
      const style = routeId === null ? ROUTE_STYLE.normal : id === routeId ? ROUTE_STYLE.focus : ROUTE_STYLE.dim
      const lift = id === routeId ? 3 : 0
      meshes.band.material.color.set(style.band)
      meshes.line.material.color.set(style.line)
      meshes.arrows.material.color.set(style.arrows)
      meshes.band.renderOrder = -20 + lift
      meshes.line.renderOrder = -19 + lift
      meshes.arrows.renderOrder = -18 + lift
    }
  }

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
    const trail = createTrail()
    trail.material.color.set(TRAIL_COLORS[vehicle.health])
    overlay.add(holder, trail)
    markers.set(vehicle.id, {
      id: vehicle.id,
      routeId: vehicle.routeId,
      geo: geoFor(vehicle.routeId),
      lengthKm: findRoute(vehicle.routeId).lengthKm,
      holder,
      miniature,
      ring,
      trail,
      bodyLength: size,
      shown: vehicle.mapProgress,
      target: vehicle.mapProgress,
      gps: vehicle.positionSource === 'gps',
      speed: vehicle.speed,
      maxLean: vehicle.kind === 'superbike' || vehicle.kind === 'bicycle' ? MAX_LEAN[vehicle.kind] : 0,
      health: vehicle.health,
    })

    // 실제 3D 모델을 다 받으면 셰이더를 미리 컴파일한 뒤 직접 만든 모형과 바꿔 끼웁니다.
    void loadModelMiniature(vehicle.modelId, vehicle.paint.hex, 'lite').then(async (model) => {
      if (disposed || !model) return
      model.root.scale.setScalar(size / model.length)
      await precompile(renderer, model.root, camera, overlay, { cancelled: () => disposed, hold: stage.hold }).catch(() => undefined)
      // 복제본은 캐시된 원본과 형상·재질을 함께 쓰므로, 그사이 장면이 닫혔으면 정리하지 않고 버립니다.
      const marker = markers.get(vehicle.id)
      if (disposed || !marker) return
      holder.remove(marker.miniature.root)
      disposeObject(marker.miniature.root)
      holder.add(model.root)
      marker.miniature = model
      stage.invalidate()
    })
  }

  /** 준비(prepare)가 끝나기 전에 받은 마지막 프레임. 끝나면 이 프레임으로 미니어처를 만듭니다. */
  let latest = frame
  let prepared = false

  function setFrame(next: FleetFrame) {
    latest = next
    if (!prepared) return
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
        marker.trail.material.color.set(TRAIL_COLORS[vehicle.health])
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

    updateTrail(marker)

    if (marker.health === 'critical' && playing) {
      marker.ring.material.opacity = 0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 260))
    } else {
      marker.ring.material.opacity = 0.9
    }
  }

  /**
   * 지나온 길을 따라 꼬리를 그립니다. 미니어처 뒤끝에서 시작해 화면에 보이는 미니어처 길이에 속도를 곱한 만큼 남기므로,
   * 빠를수록 길고 멈추면 사라집니다. 폭은 꼬리 끝으로 갈수록 가늘어집니다.
   */
  function updateTrail(marker: Marker) {
    const size = marker.holder.scale.x
    const length = size * Math.min(3, marker.speed / 20)
    marker.trail.visible = length > 0.001
    if (!marker.trail.visible) return
    const toProgress = METERS_PER_UNIT / marker.geo.length
    // 미니어처 가운데에서 뒤끝까지(반 길이)는 비웁니다.
    const head = marker.shown - ((size * marker.bodyLength) / 2) * toProgress
    const span = Math.min(0.5, length * toProgress)
    const positions = marker.trail.geometry.getAttribute('position') as BufferAttribute
    for (let i = 0; i < TRAIL_SAMPLES; i += 1) {
      const t = i / (TRAIL_SAMPLES - 1)
      const u = head - span * (1 - t)
      const point = marker.geo.pointAt(u)
      const direction = marker.geo.directionAt(u)
      const half = size * 0.16 * (0.25 + 0.75 * t)
      const x = point.x / METERS_PER_UNIT
      const z = point.z / METERS_PER_UNIT
      positions.setXYZ(i * 2, x - direction.z * half, 0.01, z + direction.x * half)
      positions.setXYZ(i * 2 + 1, x + direction.z * half, 0.01, z - direction.x * half)
    }
    positions.needsUpdate = true
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

  function project(id: string, position: Vector3, lift: number, view: LabelSize): ProjectedPoint {
    projected.copy(position)
    projected.y += lift
    projected.project(camera)
    return {
      id,
      x: ((projected.x + 1) / 2) * view.width,
      y: ((1 - projected.y) / 2) * view.height,
      visible: projected.z < 1 && Math.abs(projected.x) <= 1.1 && Math.abs(projected.y) <= 1.1,
    }
  }

  function update(delta: number) {
    if (followId === null && fittedAspect > 0 && fittedAspect !== camera.aspect) showOverview()
    for (const marker of markers.values()) place(marker, delta)
    followCamera(delta)
    controls.update()
    const view = { width: canvas.clientWidth, height: canvas.clientHeight }
    const points: ProjectedPoint[] = []
    for (const marker of markers.values()) {
      const top = project(marker.id, marker.holder.position, marker.holder.scale.x * 0.55, view)
      points.push({ ...top, baseY: project(marker.id, marker.holder.position, 0, view).y })
    }
    for (const item of places) points.push(project(item.id, item.position, 0, view))
    onProject(points, view)
  }

  function setFollow(id: string | null) {
    followId = id
    if (!prepared) return
    const marker = id === null ? undefined : markers.get(id)
    emphasize(marker?.routeId ?? null)
    if (id === null) {
      showOverview()
    } else if (marker) {
      controls.target.copy(marker.holder.position)
      camera.position.copy(marker.holder.position).add(FOLLOW_OFFSET)
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

  /**
   * 무거운 준비(반사 환경 계산, 직접 만든 미니어처)를 작업 여러 개로 나눠 하고, 장면의 셰이더를 막지 않게 미리 컴파일한 뒤
   * 첫 화면을 그립니다. 한 작업에 몰면 메인 스레드가 수백 ms 멈추고, 처음 그릴 때 컴파일하면 끝날 때까지 기다리며 멈춥니다.
   */
  async function prepare() {
    await nextTask()
    if (disposed) return
    disposeEnvironment = applyStudioEnvironment(renderer, overlay, 0.6)
    for (const vehicle of latest.vehicles) {
      await nextTask()
      if (disposed) return
      if (!markers.has(vehicle.id)) addMarker(vehicle)
    }
    prepared = true
    setFrame(latest)
    if (followId !== null) setFollow(followId)
    await Promise.all([
      precompile(renderer, scene, camera, scene, { cancelled: () => disposed }),
      precompile(renderer, overlay, camera, overlay, { cancelled: () => disposed }),
    ])
  }
  stage.hold(prepare())
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
      fade?.dispose()
      disposeObject(routeLayers)
      disposeObject(ground)
      stage.dispose()
    },
  }
}

export type TrackerScene = ReturnType<typeof createTrackerScene>
