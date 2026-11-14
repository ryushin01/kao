import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { frameShowcase } from './framing'

const FOV = 30

/** 정한 자리의 카메라로 점을 화면 좌표(NDC, -1~1)에 투영합니다. 가로세로 비는 소개 화면 턴테이블(약 1.6:1)입니다. */
function projector(center: Vector3, size: Vector3, length: number) {
  const framing = frameShowcase(center, size, length, FOV)
  const camera = new PerspectiveCamera(FOV, 1.6, 0.1, 100)
  camera.position.copy(framing.position)
  camera.lookAt(framing.target)
  camera.updateMatrixWorld()
  return { framing, project: (point: Vector3) => point.clone().project(camera) }
}

/** 경계 상자 꼭짓점 8개 */
const corners = (center: Vector3, size: Vector3) =>
  [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => new Vector3(x, y, z).multiply(size).multiplyScalar(0.5).add(center))))

/** 턴테이블 가장자리를 한 바퀴 돌며 고른 점 */
const rim = (radius: number) => Array.from({ length: 48 }, (_, i) => new Vector3(Math.cos((i / 48) * Math.PI * 2) * radius, 0, Math.sin((i / 48) * Math.PI * 2) * radius))

const inside = (point: Vector3) => Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1

describe('frameShowcase', () => {
  const sedan = { center: new Vector3(0, 0.73, 0), size: new Vector3(4.995, 1.465, 1.925), length: 4.995 }
  const mpv = { center: new Vector3(0, 0.97, 0), size: new Vector3(4.995, 1.935, 2.29), length: 4.995 }

  it.each([
    ['세단(G80)', sedan],
    ['키가 큰 MPV(Alphard)', mpv],
  ])('%s: 미니어처와 턴테이블 가장자리가 모두 화면 안에 듭니다', (_, { center, size, length }) => {
    const { framing, project } = projector(center, size, length)
    for (const corner of corners(center, size)) expect(inside(project(corner))).toBe(true)
    for (const point of rim(framing.turntable)) expect(inside(project(point))).toBe(true)
  })

  it('키가 큰 탈것은 턴테이블이 들어오도록 세단보다 멀리서 봅니다', () => {
    const near = projector(sedan.center, sedan.size, sedan.length).framing
    const far = projector(mpv.center, mpv.size, mpv.length).framing
    expect(far.distance).toBeGreaterThan(near.distance)
    // 턴테이블은 탈것 길이로 정합니다(작은 탈것도 반지름 1m 이상).
    expect(near.turntable).toBeCloseTo(4.995 * 0.62)
    expect(frameShowcase(new Vector3(0, 0.4, 0), new Vector3(1.6, 0.8, 0.5), 1.2, FOV).turntable).toBe(1)
  })
})
