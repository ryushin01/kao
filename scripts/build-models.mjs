/**
 * Sketchfab에서 내려받은 glTF 원본(assets-src/)을 화면용 GLB(public/models/)로 바꿉니다.
 *
 * 1. 모든 노드의 변환을 메시에 굽고 실제 치수·방향(+x 앞, +y 위, 바닥 y=0, 가운데 정렬)으로 맞춥니다.
 * 2. 바퀴 축 둘레의 삼각형을 떼어 바퀴 노드(wheel_N, 원점 = 축 중심)로 옮깁니다. 이름이 제각각이라 위치로 고릅니다.
 * 3. 도장 재질에 extras.kaoPaint를 붙여 화면에서 색을 바꿀 수 있게 합니다.
 * 4. 중복 제거, 단순화, 텍스처 WebP 축소, 양자화, meshopt 압축을 합니다.
 *
 * 사용: node scripts/build-models.mjs [모델 id] [--inspect] [--lite-only]
 *   --lite-only: 이미 만든 GLB에서 관제 지도용 가벼운 버전(.lite.glb)만 다시 만듭니다.
 */
import { mkdir } from 'node:fs/promises'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import {
  dedup,
  getBounds,
  join,
  meshopt,
  prune,
  quantize,
  simplify,
  simplifyPrimitive,
  textureCompress,
  transformMesh,
  transformPrimitive,
  uninstance,
  weld,
} from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'

/** 모델별 설정. 바퀴 좌표는 맞춘 뒤의 실제 치수(m)입니다. --inspect로 재질별 위치를 보고 정했습니다. */
const MODELS = {
  'genesis-g80': {
    src: 'assets-src/genesis-g80/genesis_g80/scene.gltf',
    length: 4.995,
    forward: [0, 0, 1],
    // 이름과 달리 차체 도장은 glass_painted_ral5입니다(M08_Obsidian_Black는 검은 몰딩).
    paint: /^rockit3d_material_glass_painted_ral5$/,
    drop: /^$/,
    ratio: 0.2,
    error: 0.01,
    wheels: [
      { x: 1.64, y: 0.36, z: 0.845, r: 0.37, halfWidth: 0.16 },
      { x: 1.64, y: 0.36, z: -0.845, r: 0.37, halfWidth: 0.16 },
      { x: -1.36, y: 0.36, z: 0.845, r: 0.37, halfWidth: 0.16 },
      { x: -1.36, y: 0.36, z: -0.845, r: 0.37, halfWidth: 0.16 },
    ],
  },
  'lamborghini-aventador': {
    src: 'assets-src/lamborghini-aventador/2022_lamborghini_aventador_lp780-4_ultimae/scene.gltf',
    length: 4.868,
    forward: [0, 0, 1],
    paint: /Paint_Material$/,
    drop: /^$/,
    ratio: 0.5,
    wheels: [
      { x: 1.28, y: 0.33, z: 0.88, r: 0.34, halfWidth: 0.17 },
      { x: 1.28, y: 0.33, z: -0.88, r: 0.34, halfWidth: 0.17 },
      { x: -1.425, y: 0.355, z: 0.85, r: 0.365, halfWidth: 0.2 },
      { x: -1.425, y: 0.355, z: -0.85, r: 0.365, halfWidth: 0.2 },
    ],
  },
  'ducati-panigale-v4s': {
    src: 'assets-src/ducati-panigale-v4s/ducati_panigale_v4/scene.gltf',
    length: 2.11,
    forward: [0, 0, -1],
    paint: /^body_red_paint/,
    // 금색 Öhlins 포크(Material.028)는 앞바퀴 원기둥 안까지 내려오지만 돌지 않습니다.
    keepOnBody: /calip|^Material\.028$/,
    drop: /^$/,
    ratio: 0.5,
    wheels: [
      { x: 0.75, y: 0.3, z: 0, r: 0.31, halfWidth: 0.09 },
      { x: -0.72, y: 0.33, z: 0, r: 0.34, halfWidth: 0.14 },
    ],
  },
  'genesis-essentia': {
    src: 'assets-src/2018__genesis_essentia_concept/scene.gltf',
    // 콘셉트카라 공식 전장이 없어, 타이어 지름이 실제 GT 타이어(약 0.77m)가 되도록 맞춘 어림값입니다.
    length: 4.6,
    forward: [0, 0, 1],
    // 차체는 carpaint(짙은 회색), 휠과 장식은 구리색(material, carpaimt2)입니다.
    paint: /^carpaint$/,
    // 원본 유리는 흰 반투명(불투명도 0.81, 거칠기 0.6)이라 젖빛 유리처럼 보입니다. 실제 차처럼 실내가 비치는 짙은 유리로 바꿉니다.
    glass: { match: /^windows_glass$/, color: [0.012, 0.013, 0.016, 0.55], roughness: 0.05 },
    drop: /^$/,
    ratio: 0.3,
    // 소개 화면에만 나오는 대표 모델이라 관제 지도용 가벼운 버전은 만들지 않습니다.
    wheels: [
      { x: 1.45, y: 0.39, z: 0.85, r: 0.4, halfWidth: 0.17 },
      { x: 1.45, y: 0.39, z: -0.85, r: 0.4, halfWidth: 0.17 },
      { x: -1.38, y: 0.39, z: 0.85, r: 0.4, halfWidth: 0.17 },
      { x: -1.38, y: 0.39, z: -0.85, r: 0.4, halfWidth: 0.17 },
    ],
  },
  'renault-arkana': {
    src: 'assets-src/2019_renault_arkana/scene.gltf',
    length: 4.545,
    forward: [0, 0, 1],
    paint: /^visionarq_mx_car_body_carpaint$/,
    drop: /^$/,
    ratio: 0.7,
    // 원본에 앞 왼쪽(+z) 바퀴가 없어(타이어·휠·브레이크 모두) 앞 오른쪽 바퀴를 거울로 복사합니다.
    mirror: { 0: 1 },
    wheels: [
      { x: 1.435, y: 0.345, z: 0.81, r: 0.355, halfWidth: 0.13 },
      { x: 1.435, y: 0.345, z: -0.81, r: 0.355, halfWidth: 0.13 },
      { x: -1.305, y: 0.345, z: 0.81, r: 0.355, halfWidth: 0.13 },
      { x: -1.305, y: 0.345, z: -0.81, r: 0.355, halfWidth: 0.13 },
    ],
  },
  'toyota-alphard': {
    src: 'assets-src/toyota_alphard_2025/scene.gltf',
    length: 4.995,
    forward: [1, 0, 0],
    // 차체 도장은 C_089(토요타 색 코드 089, 플래티넘 화이트 펄)입니다. 화면에서 검정으로 칠합니다.
    paint: /^C_089$/,
    drop: /^$/,
    // 원본이 삼각형 300만 개·노드 수천 개라, 같은 재질끼리 먼저 합친 뒤 크게 줄이고 텍스처(약 100장)도 512로 줄입니다.
    joinFirst: true,
    dropNormals: true,
    ratio: 0.05,
    error: 0.008,
    textureSize: [512, 512],
    // 지도용 가벼운 버전은 텍스처를 평균 색으로 바꾸고 UV를 지웁니다(UV 이음매가 단순화를 막고, 지도 크기에서는 텍스처가 보이지 않음).
    liteFlatten: true,
    wheels: [
      { x: 1.545, y: 0.365, z: 0.815, r: 0.375, halfWidth: 0.14 },
      { x: 1.545, y: 0.365, z: -0.815, r: 0.375, halfWidth: 0.14 },
      { x: -1.455, y: 0.365, z: 0.815, r: 0.375, halfWidth: 0.14 },
      { x: -1.455, y: 0.365, z: -0.815, r: 0.375, halfWidth: 0.14 },
    ],
  },
}

/** 값을 받는 옵션의 값(다음 인자). 다음 인자가 없거나 다른 옵션(--)이면 undefined입니다. 음수 좌표(-1.8,…)는 값으로 받습니다. */
function optionValue(flag) {
  const index = process.argv.indexOf(flag)
  const value = index < 0 ? undefined : process.argv[index + 1]
  return value === undefined || value.startsWith('--') ? undefined : value
}
/** --at x0,x1,y0,y1,z0,z1: 이 상자 안에 꼭짓점이 있는 재질과 개수를 봅니다(재질 위치 찾기). */
const atBox = process.argv.includes('--at') ? parseBox(optionValue('--at')) : null
/** --wheel-bounds <재질 정규식>: 바퀴 재질의 앞뒤·좌우 범위를 봅니다(바퀴 좌표 정하기). */
const wheelPattern = process.argv.includes('--wheel-bounds') ? new RegExp(optionValue('--wheel-bounds') ?? 'tire|tyre', 'i') : null
// 옵션의 값은 모델 id로 읽지 않습니다.
const operands = new Set([optionValue('--at'), optionValue('--wheel-bounds')].filter((value) => value !== undefined))
const [onlyId] = process.argv.slice(2).filter((arg) => !arg.startsWith('--') && !operands.has(arg))
const inspectOnly = process.argv.includes('--inspect')

function parseBox(text) {
  const values = (text ?? '').split(',').map((value) => (value.trim() === '' ? NaN : Number(value)))
  const [x0, x1, y0, y1, z0, z1] = values
  if (values.length !== 6 || values.some((value) => !Number.isFinite(value)) || x0 > x1 || y0 > y1 || z0 > z1) {
    console.error(`--at에는 x0,x1,y0,y1,z0,z1 여섯 숫자를 각 축의 작은 값부터 씁니다(받은 값: ${text ?? '없음'}). 예: --at -1.8,0.8,1.84,2,-0.6,0.6`)
    process.exit(1)
  }
  return values
}
await MeshoptEncoder.ready
await MeshoptDecoder.ready
await MeshoptSimplifier.ready
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })

/** forward 축을 +x, +y를 위로 두는 회전·축척·이동 행렬(열 우선 4x4) */
function normalizeMatrix(bounds, forward, length) {
  const [fx, , fz] = forward
  // 수평면에서 forward → +x로 돌리는 y축 회전. +z 축은 forward를 왼쪽으로 90° 돌린 방향.
  const cos = fx
  const sin = -fz
  const extent = Math.abs(fx) * (bounds.max[0] - bounds.min[0]) + Math.abs(fz) * (bounds.max[2] - bounds.min[2])
  const s = length / extent
  const cx = (bounds.min[0] + bounds.max[0]) / 2
  const cz = (bounds.min[2] + bounds.max[2]) / 2
  const minY = bounds.min[1]
  // p' = S * R * (p - c),  R: x' = cos*x - sin*z, z' = sin*x + cos*z
  const m = [
    s * cos, 0, s * sin, 0,
    0, s, 0, 0,
    -s * sin, 0, s * cos, 0,
    0, 0, 0, 1,
  ]
  m[12] = -(m[0] * cx + m[8] * cz)
  m[13] = -s * minY
  m[14] = -(m[2] * cx + m[10] * cz)
  return m
}

/**
 * 장면의 모든 메시를 월드 좌표로 구워, 변환 없는 노드로 장면 루트에 다시 둡니다.
 * 같은 메시·정점 데이터를 여러 노드가 나눠 쓰는 경우가 많아 프리미티브와 정점 데이터를 복제한 뒤 굽습니다.
 */
function bake(document) {
  const root = document.getRoot()
  uninstance(document)
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  const baked = []
  scene.traverse((node) => {
    const mesh = node.getMesh()
    if (!mesh) return
    const world = node.getWorldMatrix()
    const copy = document.createMesh(mesh.getName())
    for (const prim of mesh.listPrimitives()) {
      const clone = prim.clone()
      for (const semantic of clone.listSemantics()) clone.setAttribute(semantic, clone.getAttribute(semantic).clone())
      if (clone.getIndices()) clone.setIndices(clone.getIndices().clone())
      clone.listTargets().forEach((target) => clone.removeTarget(target))
      transformPrimitive(clone, world)
      copy.addPrimitive(clone)
    }
    baked.push(document.createNode(node.getName()).setMesh(copy))
  })
  for (const child of scene.listChildren()) scene.removeChild(child)
  for (const node of root.listNodes()) if (!baked.includes(node)) node.dispose()
  const keep = new Set(baked.map((node) => node.getMesh()))
  for (const mesh of root.listMeshes()) if (!keep.has(mesh)) mesh.dispose()
  baked.forEach((node) => scene.addChild(node))
}

function materialBounds(document) {
  const result = new Map()
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const name = prim.getMaterial()?.getName() ?? '(none)'
      const pos = prim.getAttribute('POSITION')
      if (!pos) continue
      const min = pos.getMin([])
      const max = pos.getMax([])
      const entry = result.get(name) ?? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], tris: 0 }
      for (let i = 0; i < 3; i += 1) {
        entry.min[i] = Math.min(entry.min[i], min[i])
        entry.max[i] = Math.max(entry.max[i], max[i])
      }
      entry.tris += (prim.getIndices()?.getCount() ?? pos.getCount()) / 3
      result.set(name, entry)
    }
  }
  return result
}

/** 바퀴 축 둘레(원기둥 안)에 무게중심이 있는 삼각형을 바퀴별 프리미티브로 떼어 냅니다. */
function splitWheels(document, wheels, keepOnBody) {
  const root = document.getRoot()
  const buffer = root.listBuffers()[0]
  const wheelPrims = wheels.map(() => [])
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (keepOnBody.test(prim.getMaterial()?.getName() ?? '')) continue
      const pos = prim.getAttribute('POSITION')
      const indices = prim.getIndices()
      if (!pos || !indices || prim.getMode() !== 4) continue
      const groups = wheels.map(() => [])
      const rest = []
      const a = [], b = [], c = []
      for (let i = 0; i < indices.getCount(); i += 3) {
        const ia = indices.getScalar(i), ib = indices.getScalar(i + 1), ic = indices.getScalar(i + 2)
        pos.getElement(ia, a); pos.getElement(ib, b); pos.getElement(ic, c)
        // 세 꼭짓점이 모두 바퀴 원기둥 안에 있어야 바퀴로 봅니다(포크·스윙암 같은 걸친 부품 제외).
        const inside = (w, p) => (p[0] - w.x) ** 2 + (p[1] - w.y) ** 2 <= (w.r * 1.02) ** 2 && Math.abs(p[2] - w.z) <= w.halfWidth
        const hit = wheels.findIndex((w) => inside(w, a) && inside(w, b) && inside(w, c))
        ;(hit >= 0 ? groups[hit] : rest).push(ia, ib, ic)
      }
      if (groups.every((g) => g.length === 0)) continue
      const make = (list) => {
        const index = document.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(new Uint32Array(list))
        return prim.clone().setIndices(index)
      }
      groups.forEach((list, i) => list.length && wheelPrims[i].push(make(list)))
      if (rest.length) prim.setIndices(document.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(new Uint32Array(rest)))
      else mesh.removePrimitive(prim)
    }
  }
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  wheels.forEach((wheel, i) => {
    if (!wheelPrims[i].length) return
    const mesh = document.createMesh(`wheel_${i}`)
    wheelPrims[i].forEach((prim) => mesh.addPrimitive(prim))
    transformMesh(mesh, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -wheel.x, -wheel.y, -wheel.z, 1])
    scene.addChild(document.createNode(`wheel_${i}`).setMesh(mesh).setTranslation([wheel.x, wheel.y, wheel.z]))
  })
  return wheelPrims.map((list) => list.length)
}

async function build(id, config) {
  const document = await io.read(config.src)
  bake(document)
  const root = document.getRoot()
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  const matrix = normalizeMatrix(getBounds(scene), config.forward, config.length)
  for (const mesh of root.listMeshes()) transformMesh(mesh, matrix)

  if (atBox) {
    // 이 상자(x0,x1,y0,y1,z0,z1) 안에 꼭짓점이 있는 재질과 개수
    const [x0, x1, y0, y1, z0, z1] = atBox
    console.log(`=== ${id}`)
    const counts = new Map()
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION')
        const p = []
        for (let i = 0; i < pos.getCount(); i += 1) {
          pos.getElement(i, p)
          if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1 || p[2] < z0 || p[2] > z1) continue
          const name = prim.getMaterial()?.getName() ?? '(none)'
          counts.set(name, (counts.get(name) ?? 0) + 1)
        }
      }
    }
    for (const [name, count] of [...counts].sort((a, b) => b[1] - a[1])) console.log(String(count).padStart(7), name)
    return
  }

  if (wheelPattern) {
    // 바퀴 재질(타이어·휠) 꼭짓점을 앞뒤·좌우 네 구역으로 나눠 범위를 봅니다(바퀴 좌표 정할 때).
    const pattern = wheelPattern
    console.log(`=== ${id}`)
    const zones = new Map()
    for (const mesh of root.listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        if (!pattern.test(prim.getMaterial()?.getName() ?? '')) continue
        const pos = prim.getAttribute('POSITION')
        const p = []
        for (let i = 0; i < pos.getCount(); i += 1) {
          pos.getElement(i, p)
          const key = `${p[0] > 0 ? '앞' : '뒤'}${p[2] > 0 ? '+z' : '-z'}`
          const zone = zones.get(key) ?? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
          for (let k = 0; k < 3; k += 1) {
            zone.min[k] = Math.min(zone.min[k], p[k])
            zone.max[k] = Math.max(zone.max[k], p[k])
          }
          zones.set(key, zone)
        }
      }
    }
    for (const [key, { min, max }] of zones) console.log(key, 'min', min.map((v) => v.toFixed(3)).join(','), 'max', max.map((v) => v.toFixed(3)).join(','))
    return
  }

  if (inspectOnly) {
    console.log(`\n=== ${id}`, JSON.stringify(getBounds(scene), (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v)))
    for (const [name, { min, max, tris }] of materialBounds(document)) {
      const f = (v) => v.map((n) => n.toFixed(2)).join(',')
      console.log(`${name.slice(0, 60).padEnd(60)} tris ${String(Math.round(tris)).padStart(7)}  min ${f(min)}  max ${f(max)}`)
    }
    return
  }

  for (const material of root.listMaterials()) {
    if (config.paint.test(material.getName())) material.setExtras({ ...material.getExtras(), kaoPaint: true })
    // 유리 색(RGBA, 선형)과 거칠기를 바꿉니다(glass: { match, color, roughness }).
    if (config.glass?.match.test(material.getName())) material.setBaseColorFactor(config.glass.color).setRoughnessFactor(config.glass.roughness)
  }
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) if (config.drop.test(prim.getMaterial()?.getName() ?? '-')) mesh.removePrimitive(prim)
  }
  const counts = splitWheels(document, config.wheels, config.keepOnBody ?? /calip/i)
  // 원본에 빠진 바퀴는 반대쪽 바퀴를 거울로 복사합니다(mirror: { 빠진 바퀴: 복사할 바퀴 }). 거울 변환은 면 방향도 뒤집습니다.
  for (const [target, source] of Object.entries(config.mirror ?? {})) {
    const from = scene.listChildren().find((node) => node.getName() === `wheel_${source}`)
    if (!from?.getMesh()) throw new Error(`${id}: 거울로 복사할 wheel_${source}가 없습니다.`)
    const mesh = document.createMesh(`wheel_${target}`)
    for (const prim of from.getMesh().listPrimitives()) {
      const clone = prim.clone()
      for (const semantic of clone.listSemantics()) clone.setAttribute(semantic, clone.getAttribute(semantic).clone())
      if (clone.getIndices()) clone.setIndices(clone.getIndices().clone())
      mesh.addPrimitive(clone)
    }
    transformMesh(mesh, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1])
    const wheel = config.wheels[target]
    scene.addChild(document.createNode(`wheel_${target}`).setMesh(mesh).setTranslation([wheel.x, wheel.y, wheel.z]))
    counts[target] = counts[source]
  }
  const missing = counts.flatMap((count, index) => (count === 0 ? [index] : []))
  if (missing.length) throw new Error(`${id}: wheel_${missing.join(', wheel_')}에서 형상을 찾지 못했습니다. --inspect로 바퀴 좌표를 다시 확인해 주세요.`)

  // 바퀴가 아닌 메시는 몸체 노드 하나로 모읍니다. 부품 이름은 지워 같은 재질끼리 합쳐지게 합니다(join은 이름 있는 노드를 남김).
  const body = document.createNode('body')
  for (const node of scene.listChildren()) {
    if (node.getName().startsWith('wheel_') || !node.getMesh()) continue
    scene.removeChild(node)
    node.setName('')
    node.getMesh().setName('')
    body.addChild(node)
  }
  scene.addChild(body)

  // 법선이 갈라진 정점은 합쳐지지 않아 단순화가 막히므로, dropNormals면 법선을 지우고 화면에서 불러올 때 다시 계산합니다.
  if (config.dropNormals) {
    for (const prim of root.listMeshes().flatMap((mesh) => mesh.listPrimitives())) {
      prim.setAttribute('NORMAL', null)
      prim.setAttribute('TANGENT', null)
    }
  }
  // 부품이 아주 많은 모델(joinFirst)은 먼저 합친 뒤 줄입니다. 단순화 오차 한도가 부품 크기 기준이라 작은 부품은 거의 줄지 않습니다.
  const simplifyStep = simplify({ simplifier: MeshoptSimplifier, ratio: config.ratio, error: config.error ?? 0.001, lockBorder: false })
  await document.transform(
    dedup(),
    prune(),
    weld(),
    ...(config.joinFirst ? [join({ keepNamed: true }), simplifyStep] : [simplifyStep, join({ keepNamed: true })]),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: config.textureSize ?? [1024, 1024], quality: 82 }),
    prune(),
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  )
  await mkdir('public/models', { recursive: true })
  await io.write(`public/models/${id}.glb`, document)
  const tris = [...materialBounds(document).values()].reduce((sum, e) => sum + e.tris, 0)
  console.log(`${id}: 바퀴 프리미티브 ${counts.join('/')} · 삼각형 약 ${Math.round(tris)} · public/models/${id}.glb`)
  if (config.lite !== false) await buildLite(id, config)
}

/** 이보다 작은 부품은 가장자리를 잠근 채 조금만 줄입니다(부품이 통째로 사라지거나 구멍이 나지 않게). */
const LITE_SMALL_TRIANGLES = 1500

/**
 * 관제 지도용 가벼운 버전(.lite.glb). 지도에서는 미니어처가 작게 보이므로 크게 단순화합니다.
 * 노멀이 있으면 각진 경계가 잠겨 단순화가 거의 안 되므로 노멀을 지우고, 화면에서 불러올 때 다시 계산합니다.
 * 반투명 재질(유리)은 줄이지 않습니다. 얇은 열린 면이라 가장자리가 무너지며 구멍이 납니다(아벤타도르 앞유리).
 * 작은 부품은 가장자리를 잠근 채 조금만 줄이고, 큰 부품만 크게 줄입니다.
 */
/** sRGB(0~1) → 선형 */
const toLinear = (value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)

/**
 * 텍스처를 평균 색으로 바꿔 재질의 기본 색에 곱하고, 텍스처와 UV를 지웁니다.
 * 텍스처 알파로 비치는 곳을 정하는 재질(BLEND·MASK: 스티커, 세라믹 점 무늬 유리)은 그대로 둡니다(평균 색으로 바꾸면 투명한 곳이 막힘).
 */
async function flattenTextures(document) {
  const kept = new Set()
  for (const material of document.getRoot().listMaterials()) {
    if (material.getAlphaMode() !== 'OPAQUE' && material.getBaseColorTexture()) {
      kept.add(material)
      continue
    }
    const image = material.getBaseColorTexture()?.getImage()
    if (image) {
      const { channels } = await sharp(image).stats()
      const [r, g, b] = channels.slice(0, 3).map((channel) => toLinear(channel.mean / 255))
      const [fr, fg, fb, fa] = material.getBaseColorFactor()
      material.setBaseColorFactor([fr * r, fg * g, fb * b, fa])
    }
    material
      .setBaseColorTexture(null)
      .setMetallicRoughnessTexture(null)
      .setNormalTexture(null)
      .setOcclusionTexture(null)
      .setEmissiveTexture(null)
  }
  for (const prim of document.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives())) {
    if (kept.has(prim.getMaterial())) continue
    for (const semantic of prim.listSemantics()) if (semantic.startsWith('TEXCOORD_')) prim.setAttribute(semantic, null)
  }
}

async function buildLite(id, config = MODELS[id]) {
  const lite = await io.read(`public/models/${id}.glb`)
  for (const prim of lite.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives())) {
    prim.setAttribute('NORMAL', null)
    prim.setAttribute('TANGENT', null)
  }
  if (config.liteFlatten) await flattenTextures(lite)
  await lite.transform(dedup(), weld())
  let kept = 0
  for (const prim of lite.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives())) {
    const triangles = (prim.getIndices()?.getCount() ?? 0) / 3
    if (prim.getMaterial()?.getAlphaMode() === 'BLEND') {
      kept += triangles
      continue
    }
    const small = triangles < LITE_SMALL_TRIANGLES
    simplifyPrimitive(prim, {
      simplifier: MeshoptSimplifier,
      ratio: small ? 0.3 : 0.08,
      error: small ? 0.01 : 0.02,
      lockBorder: small,
    })
  }
  await lite.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [256, 256], quality: 75 }),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  )
  await io.write(`public/models/${id}.lite.glb`, lite)
  const tris = [...materialBounds(lite).values()].reduce((sum, e) => sum + e.tris, 0)
  console.log(`${id}: 지도용 삼각형 약 ${Math.round(tris)}(그대로 둔 유리 ${Math.round(kept)}) · public/models/${id}.lite.glb`)
}

if (onlyId && !(onlyId in MODELS)) {
  console.error(`알 수 없는 모델 id: ${onlyId} (가능한 값: ${Object.keys(MODELS).join(', ')})`)
  process.exit(1)
}

const liteOnly = process.argv.includes('--lite-only')
for (const [id, config] of Object.entries(MODELS)) {
  if (onlyId && onlyId !== id) continue
  if (liteOnly) {
    if (config.lite !== false) await buildLite(id, config)
  }
  else await build(id, config)
}
