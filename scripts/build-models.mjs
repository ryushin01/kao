/**
 * Sketchfab에서 내려받은 glTF 원본(assets-src/)을 화면용 GLB(public/models/)로 바꿉니다.
 *
 * 1. 모든 노드의 변환을 메시에 굽고 실제 치수·방향(+x 앞, +y 위, 바닥 y=0, 가운데 정렬)으로 맞춥니다.
 * 2. 바퀴 축 둘레의 삼각형을 떼어 바퀴 노드(wheel_N, 원점 = 축 중심)로 옮깁니다. 이름이 제각각이라 위치로 고릅니다.
 * 3. 도장 재질에 extras.kaoPaint를 붙여 화면에서 색을 바꿀 수 있게 합니다.
 * 4. 중복 제거, 단순화, 텍스처 WebP 축소, 양자화, meshopt 압축을 합니다.
 *
 * 사용: node scripts/build-models.mjs [모델 id] [--inspect]
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
}

const [onlyId] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const inspectOnly = process.argv.includes('--inspect')
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
  }
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) if (config.drop.test(prim.getMaterial()?.getName() ?? '-')) mesh.removePrimitive(prim)
  }
  const counts = splitWheels(document, config.wheels, config.keepOnBody ?? /calip/i)

  // 바퀴가 아닌 메시는 몸체 노드 하나로 모읍니다.
  const body = document.createNode('body')
  for (const node of scene.listChildren()) {
    if (node.getName().startsWith('wheel_') || !node.getMesh()) continue
    scene.removeChild(node)
    body.addChild(node)
  }
  scene.addChild(body)

  await document.transform(
    dedup(),
    prune(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: config.ratio, error: config.error ?? 0.001, lockBorder: false }),
    join({ keepNamed: true }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
    prune(),
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  )
  await mkdir('public/models', { recursive: true })
  await io.write(`public/models/${id}.glb`, document)
  const tris = [...materialBounds(document).values()].reduce((sum, e) => sum + e.tris, 0)
  console.log(`${id}: 바퀴 프리미티브 ${counts.join('/')} · 삼각형 약 ${Math.round(tris)} · public/models/${id}.glb`)
  await buildLite(id)
}

/**
 * 관제 지도용 가벼운 버전(.lite.glb). 지도에서는 미니어처가 작게 보이므로 크게 단순화합니다.
 * 노멀이 있으면 각진 경계가 잠겨 단순화가 거의 안 되므로 노멀을 지우고, 화면에서 불러올 때 다시 계산합니다.
 */
async function buildLite(id) {
  const lite = await io.read(`public/models/${id}.glb`)
  for (const prim of lite.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives())) {
    prim.setAttribute('NORMAL', null)
    prim.setAttribute('TANGENT', null)
  }
  await lite.transform(
    dedup(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: 0.08, error: 0.02, lockBorder: false }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [256, 256], quality: 75 }),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  )
  await io.write(`public/models/${id}.lite.glb`, lite)
  const tris = [...materialBounds(lite).values()].reduce((sum, e) => sum + e.tris, 0)
  console.log(`${id}: 지도용 삼각형 약 ${Math.round(tris)} · public/models/${id}.lite.glb`)
}

for (const [id, config] of Object.entries(MODELS)) {
  if (onlyId && onlyId !== id) continue
  await build(id, config)
}
