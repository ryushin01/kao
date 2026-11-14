import { BufferAttribute, BufferGeometry, DataTexture, DoubleSide, Group, LessEqualDepth, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three'
import { buildMapLayers, ribbonArrays, ROAD_STYLE } from './map-geometry'
import type { MapBounds, MeshArrays, SeoulMapData, SeoulMapLayers } from './map-geometry'

/**
 * 관제 지도의 서울 도심 바탕(도로·한강·공원·높은 건물). scripts/build-seoul-map.mjs가 OpenStreetMap으로 만든
 * public/maps/seoul.json을 웹 워커가 받아 도형(typed array)으로 만들고, 메인 스레드는 그 배열로 메시만 만듭니다.
 * 워커를 쓸 수 없으면 같은 계산을 메인 스레드에서 합니다. 지도 데이터 © OpenStreetMap 기여자(ODbL).
 */

export const SEOUL_MAP_URL = '/maps/seoul.json'

interface WorkerReply {
  layers?: SeoulMapLayers
  error?: string
}

function buildInWorker(unit: number) {
  return new Promise<SeoulMapLayers>((resolve, reject) => {
    const worker = new Worker(new URL('./seoul-map.worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', ({ data }: MessageEvent<WorkerReply>) => {
      worker.terminate()
      if (data.layers) resolve(data.layers)
      else reject(new Error(data.error ?? '지도 도형을 만들지 못했습니다.'))
    })
    worker.addEventListener('error', (event) => {
      worker.terminate()
      reject(new Error(event.message))
    })
    worker.postMessage({ url: new URL(SEOUL_MAP_URL, window.location.href).href, unit })
  })
}

async function buildOnMainThread(unit: number) {
  const response = await fetch(SEOUL_MAP_URL)
  if (!response.ok) throw new Error(`지도 데이터를 받지 못했습니다(${response.status}).`)
  return buildMapLayers((await response.json()) as SeoulMapData, unit)
}

let request: Promise<SeoulMapLayers | null> | null = null

/**
 * 지도 도형은 한 번만 만들고, 화면을 다시 열 때는 만들어 둔 배열로 메시만 다시 만듭니다.
 * 받지 못하면 null이고, 관제 지도는 바탕 없이 경로만 그립니다.
 */
export function loadSeoulMap(unit: number) {
  request ??= (typeof Worker === 'function' ? buildInWorker(unit) : Promise.reject(new Error('웹 워커 없음')))
    .catch(() => buildOnMainThread(unit))
    .catch(() => null)
  return request
}

export function toGeometry({ positions, index, colors }: MeshArrays) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  if (colors) geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setIndex(new BufferAttribute(index, 1))
  geometry.computeBoundingSphere()
  return geometry
}

/** 선을 따라 폭이 일정한 띠(경로·방향 표시에 씀). 자세한 설명은 ribbonArrays */
export function ribbon(lines: ReadonlyArray<ArrayLike<number>>, width: number, unit: number, closed = false) {
  return toGeometry(ribbonArrays(lines, width, unit, closed))
}

/**
 * 지면 위 평면 레이어. 모두 같은 높이(0)에 있어 깊이 대신 그리는 순서(renderOrder, 음수라 건물·미니어처보다 먼저)로 겹칩니다.
 */
export function flatLayer(geometry: BufferGeometry, color: string, order: number, opacity = 1) {
  const mesh = new Mesh(
    geometry,
    new MeshBasicMaterial({ color, side: DoubleSide, depthTest: false, depthWrite: false, transparent: opacity < 1, opacity }),
  )
  mesh.renderOrder = order
  return mesh
}

/** 건물 불투명도. 앞면만 이만큼 덮어, 건물 뒤의 길과 주행 경로가 희미하게 비쳐 보입니다. */
export const BUILDING_OPACITY = 0.82

/** 공원 → 한강 → 도로(낮은 등급부터) 순서로 깐 바탕 위에 높은 건물을 세웁니다. */
export function buildSeoulMap(layers: SeoulMapLayers) {
  const group = new Group()
  group.add(flatLayer(toGeometry(layers.parks), '#0b130d', -40))
  group.add(flatLayer(toGeometry(layers.water), '#0a1420', -39))
  const colors = new Map(ROAD_STYLE.map(([kind, , color]) => [kind, color]))
  layers.roads.forEach(({ kind, mesh }, i) => group.add(flatLayer(toGeometry(mesh), colors.get(kind) ?? '#353031', -38 + i)))
  // 건물은 두 번 그립니다. 먼저 깊이만 써서(불투명 단계) 가장 앞의 면을 정하고, 반투명 단계에서 그 면에만 색을 칠합니다.
  // 그래서 건물끼리 겹친 안쪽 면은 보이지 않고, 평면 레이어(길·경로)만 건물 너머로 비칩니다.
  const buildings = toGeometry(layers.buildings)
  const depth = new Mesh(buildings, new MeshBasicMaterial({ colorWrite: false }))
  const faces = new Mesh(
    buildings,
    new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: BUILDING_OPACITY, depthWrite: false, depthFunc: LessEqualDepth }),
  )
  group.add(depth, faces)
  return group
}

/**
 * 지도 끝을 바닥색으로 흐리게 묻는 판. 범위 끝에서 안쪽으로 fade(m)만큼 서서히 진해지고(모서리는 둥글게),
 * 범위 밖은 바닥색입니다. 투명 메시라 불투명한 지도 레이어 뒤에 그려지고, 깊이 검사로 건물은 덮지 않습니다.
 */
export function edgeFade(bounds: MapBounds, fade: number, unit: number, color: string) {
  const margin = fade / 2
  const minX = bounds.minX - margin
  const maxX = bounds.maxX + margin
  const minZ = bounds.minZ - margin
  const maxZ = bounds.maxZ + margin
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerZ = (bounds.minZ + bounds.maxZ) / 2
  const innerX = (bounds.maxX - bounds.minX) / 2 - fade
  const innerZ = (bounds.maxZ - bounds.minZ) / 2 - fade
  const size = 128
  const alpha = new Uint8Array(size * size * 4)
  for (let row = 0; row < size; row += 1) {
    // 판을 눕히면 텍스처 아래쪽(v = 0)이 남쪽(maxZ)입니다.
    const z = maxZ - ((row + 0.5) / size) * (maxZ - minZ)
    for (let column = 0; column < size; column += 1) {
      const x = minX + ((column + 0.5) / size) * (maxX - minX)
      const t = Math.min(1, Math.hypot(Math.max(0, Math.abs(x - centerX) - innerX), Math.max(0, Math.abs(z - centerZ) - innerZ)) / fade)
      // alphaMap은 초록 채널을 씁니다.
      alpha[(row * size + column) * 4 + 1] = Math.round(t * t * (3 - 2 * t) * 255)
    }
  }
  const texture = new DataTexture(alpha, size, size)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.needsUpdate = true
  const geometry = new PlaneGeometry((maxX - minX) / unit, (maxZ - minZ) / unit).rotateX(-Math.PI / 2)
  geometry.translate(centerX / unit, 0, centerZ / unit)
  const material = new MeshBasicMaterial({ color, alphaMap: texture, transparent: true, depthWrite: false })
  const mesh = new Mesh(geometry, material)
  mesh.renderOrder = -30
  return {
    mesh,
    dispose() {
      geometry.dispose()
      material.dispose()
      texture.dispose()
    },
  }
}
