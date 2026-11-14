import { PMREMGenerator } from 'three'
import type { Scene, WebGLRenderer } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

/**
 * 도장과 유리에 반사가 생기도록 스튜디오 조명 환경을 씌웁니다.
 * size는 반사 지도 한 면의 해상도입니다. 장면을 만들 때 GPU로 계산하므로, 모형이 작게 보이는 곳은 낮춰 시작을 가볍게 합니다.
 */
export function applyStudioEnvironment(renderer: WebGLRenderer, scene: Scene, intensity = 0.55, size = 256) {
  const pmrem = new PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const target = pmrem.fromScene(room, 0.04, 0.1, 100, { size })
  scene.environment = target.texture
  scene.environmentIntensity = intensity
  room.dispose()
  pmrem.dispose()
  return () => target.dispose()
}
