import { Group, Mesh, MeshPhysicalMaterial } from 'three'
import type { Material, MeshStandardMaterial, Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { VehicleModelId } from '@shared/api'
import { MODEL_ASSETS } from '../../config/model-assets'
import type { Miniature } from './parts'

let loader: GLTFLoader | null = null
export type ModelDetail = 'full' | 'lite'

const cache = new Map<string, Promise<Group | null>>()

function load(modelId: VehicleModelId, detail: ModelDetail): Promise<Group | null> {
  const asset = MODEL_ASSETS[modelId]
  if (!asset) return Promise.resolve(null)
  const key = `${modelId}:${detail}`
  let pending = cache.get(key)
  if (!pending) {
    if (!loader) {
      // 3D 모델의 meshopt 압축은 웹 워커 두 개에서 풉니다(메인 스레드가 수백 ms씩 멈추지 않게).
      if (typeof Worker !== 'undefined') MeshoptDecoder.useWorkers(2)
      loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    }
    pending = loader
      .loadAsync(detail === 'lite' ? asset.liteUrl : asset.url)
      .then((gltf) => {
        // 가벼운 버전은 단순화하려고 노멀을 지웠으므로 여기서 다시 계산합니다.
        gltf.scene.traverse((object) => {
          if (object instanceof Mesh && !object.geometry.getAttribute('normal')) object.geometry.computeVertexNormals()
        })
        return gltf.scene
      })
      .catch(() => {
        // 받지 못하면 직접 만든 모형을 그대로 씁니다. 다음에 다시 시도할 수 있게 비웁니다.
        cache.delete(key)
        return null
      })
    cache.set(key, pending)
  }
  return pending
}

/** 도장 재질만 복제해 색을 바꿉니다. 나머지 재질은 같은 모델끼리 함께 씁니다. */
function repaint(root: Object3D, paintHex: string) {
  const painted = new Map<Material, Material>()
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    object.castShadow = true
    const swap = (material: Material) => {
      if (!material.userData.kaoPaint) return material
      let copy = painted.get(material)
      if (!copy) {
        const source = material as MeshStandardMaterial
        copy = new MeshPhysicalMaterial({
          color: paintHex,
          metalness: 0.6,
          roughness: 0.32,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
          normalMap: source.normalMap,
          side: source.side,
        })
        painted.set(material, copy)
      }
      return copy
    }
    object.material = Array.isArray(object.material) ? object.material.map(swap) : swap(object.material)
  })
}

/**
 * 실제 3D 모델(GLB)로 미니어처를 만듭니다. 모델 파일이 없거나 받지 못하면 null을 돌려줍니다.
 * detail이 'lite'면 관제 지도용 가벼운 버전(.lite.glb)을 씁니다.
 * GLB는 scripts/build-models.mjs가 실제 치수, +x 앞 방향, 바퀴 노드(wheel_N)로 맞춰 둔 것입니다.
 */
/**
 * 3D 모델 다운로드만 먼저 걸어 둡니다(결과는 기억해 두고 loadModelMiniature가 이어 씁니다).
 * 장면을 만들 때 조명 환경 계산처럼 오래 걸리는 일보다 먼저 불러, 네트워크를 기다리는 시간을 겹칩니다.
 */
export function preloadModel(modelId: VehicleModelId, detail: ModelDetail = 'full') {
  void load(modelId, detail)
}

export async function loadModelMiniature(
  modelId: VehicleModelId,
  paintHex: string,
  detail: ModelDetail = 'full',
): Promise<Miniature | null> {
  const asset = MODEL_ASSETS[modelId]
  const source = await load(modelId, detail)
  if (!asset || !source) return null

  const model = source.clone(true)
  repaint(model, paintHex)
  const root = new Group()
  const leanPivot = asset.leans ? new Group() : null
  ;(leanPivot ?? root).add(model)
  if (leanPivot) root.add(leanPivot)

  const wheels: Miniature['wheels'] = []
  model.traverse((object) => {
    const match = /^wheel_(\d+)$/.exec(object.name)
    if (match) wheels.push({ object, radius: asset.wheelRadii[Number(match[1])] ?? 0.33 })
  })
  return { root, wheels, leanPivot, length: asset.length }
}
