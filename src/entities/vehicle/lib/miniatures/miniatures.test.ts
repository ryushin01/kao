import { Box3, Color, Mesh, Vector3 } from 'three'
import type { Material, Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import type { VehicleModelId } from '@shared/api'
import { MODEL_ASSETS } from '../../config/model-assets'
import { MODEL_PROFILES } from '../../config/models'
import { createMiniature, rollWheels } from './index'

const MODEL_IDS = Object.keys(MODEL_PROFILES) as VehicleModelId[]
const PAINT = '#123456'

/** 도장 색이 칠해진 메시 수 */
function paintedMeshes(root: Object3D) {
  const paint = new Color(PAINT)
  let count = 0
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return
    const materials: Material[] = Array.isArray(object.material) ? object.material : [object.material]
    if (materials.some((material) => 'color' in material && (material.color as Color).equals(paint))) count += 1
  })
  return count
}

describe('createMiniature(직접 만든 모형: 3D 모델을 받기 전과 받지 못했을 때)', () => {
  it.each(MODEL_IDS)('%s: 실제 치수(+x 앞)로 땅 위에 서고, 바퀴가 땅에 닿으며 도장 색이 칠해집니다', (id) => {
    const miniature = createMiniature(id, PAINT)
    const bounds = new Box3().setFromObject(miniature.root)
    const size = bounds.getSize(new Vector3())
    // 앞뒤 길이는 전장에 가깝고(거울·핸들 등이 조금 더 나옴), 바닥은 땅(y = 0)에 닿습니다.
    expect(size.x).toBeGreaterThan(miniature.length * 0.95)
    expect(size.x).toBeLessThan(miniature.length * 1.2)
    expect(Math.abs(bounds.min.y)).toBeLessThan(0.01)
    expect(paintedMeshes(miniature.root)).toBeGreaterThan(0)

    // 이륜차는 바퀴 둘에 기울기 노드가 있고, 나머지는 바퀴 넷입니다.
    expect(miniature.wheels).toHaveLength(miniature.leanPivot ? 2 : 4)
    const asset = MODEL_ASSETS[id]
    miniature.wheels.forEach((wheel, index) => {
      const center = wheel.object.getWorldPosition(new Vector3())
      expect(Math.abs(center.y - wheel.radius)).toBeLessThan(0.015)
      // 3D 모델로 바꿔 끼워도 바퀴가 같은 빠르기로 구르도록 반지름을 맞춥니다.
      if (asset) expect(Math.abs(wheel.radius - asset.wheelRadii[index]!)).toBeLessThan(0.02)
    })
  })

  it('굴러간 거리만큼 바퀴를 돌립니다(한 둘레를 가면 한 바퀴)', () => {
    const miniature = createMiniature('toyota-alphard', PAINT)
    const [wheel] = miniature.wheels
    const before = wheel!.object.rotation.z
    rollWheels(miniature, 2 * Math.PI * wheel!.radius)
    expect(wheel!.object.rotation.z - before).toBeCloseTo(-2 * Math.PI)
  })
})
