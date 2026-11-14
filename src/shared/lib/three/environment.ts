import { PMREMGenerator } from 'three'
import type { Scene, WebGLRenderer } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

/**
 * 도장과 유리에 반사가 생기도록 스튜디오 조명 환경을 씌웁니다.
 * 반사 지도 한 면은 256입니다(three.js 0.187의 PMREMGenerator는 256보다 작게 만들지 않습니다).
 */
export function applyStudioEnvironment(renderer: WebGLRenderer, scene: Scene, intensity = 0.55) {
  const pmrem = new PMREMGenerator(renderer)
  const room = new RoomEnvironment()
  const target = pmrem.fromScene(room, 0.04, 0.1, 100)
  scene.environment = target.texture
  scene.environmentIntensity = intensity
  room.dispose()
  pmrem.dispose()
  return () => target.dispose()
}
