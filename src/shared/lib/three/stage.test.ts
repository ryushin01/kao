import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, Scene } from 'three'
import type { Camera, WebGLRenderer } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { disposeObject, markShared, precompile, sharedResourcesOf } from './stage'

/** compileAsync를 부른 순서와 그때 걸려 있던 렌더 타깃을 적어 두는 가짜 렌더러(WebGL 없이) */
function fakeRenderer() {
  let target: unknown = null
  const calls: Array<{ name: string; target: unknown }> = []
  const renderer = {
    getRenderTarget: () => target,
    setRenderTarget: (next: unknown) => {
      target = next
    },
    compileAsync: vi.fn(async (object: { name: string }) => {
      calls.push({ name: object.name, target })
    }),
  }
  return { renderer: renderer as unknown as WebGLRenderer, calls, current: () => target }
}

const mesh = (name: string, transmission = 0) => {
  const item = new Mesh(new BoxGeometry(), transmission ? new MeshPhysicalMaterial({ transmission }) : new MeshBasicMaterial())
  item.name = name
  return item
}
const camera = {} as Camera

describe('precompile', () => {
  it('물체마다 셰이더를 컴파일하고, 투과 재질이 없으면 한 번으로 끝납니다', async () => {
    const { renderer, calls } = fakeRenderer()
    const root = new Group()
    root.add(mesh('a'), mesh('b'))
    const hold = vi.fn()
    await precompile(renderer, root, camera, new Scene(), { hold })
    expect(calls.map((call) => call.name)).toEqual(['a', 'b'])
    expect(calls.every((call) => call.target === null)).toBe(true)
    expect(hold).not.toHaveBeenCalled()
  })

  it('투과 재질이 있으면 렌더 타깃을 건 채로 새 물체와 장면의 물체를 한 번 더 컴파일하고, 그동안 그리기를 멈춥니다', async () => {
    const { renderer, calls, current } = fakeRenderer()
    const scene = new Scene()
    scene.add(mesh('plate'))
    const root = new Group()
    root.add(mesh('glass', 1), mesh('body'))
    const hold = vi.fn()
    await precompile(renderer, root, camera, scene, { hold })
    expect(calls.filter((call) => call.target === null).map((call) => call.name)).toEqual(['glass', 'body'])
    expect(calls.filter((call) => call.target !== null).map((call) => call.name)).toEqual(['glass', 'body', 'plate'])
    expect(hold).toHaveBeenCalledTimes(1)
    // 렌더 타깃은 컴파일 한 번마다 걸었다 되돌려 놓습니다.
    expect(current()).toBeNull()
  })

  it('장면이 닫히면(cancelled) 남은 컴파일을 그만둡니다', async () => {
    const { renderer, calls } = fakeRenderer()
    const root = new Group()
    for (let i = 0; i < 5; i += 1) root.add(mesh(`m${i}`, 1))
    let closed = false
    renderer.compileAsync = vi.fn(async (object: { name: string }) => {
      calls.push({ name: object.name, target: null })
      if (calls.length === 2) closed = true
    }) as unknown as WebGLRenderer['compileAsync']
    await precompile(renderer, root, camera, new Scene(), { cancelled: () => closed })
    expect(calls.map((call) => call.name)).toEqual(['m0', 'm1'])
  })
})

describe('disposeObject', () => {
  it('모델을 바꿔 내릴 때(keepShared)는 캐시 원본과 함께 쓰는 형상·재질을 남기고, 장면을 닫을 때는 모두 정리합니다', () => {
    const geometry = new BoxGeometry()
    const material = new MeshBasicMaterial()
    markShared(new Mesh(geometry, material))
    // 복제본: 형상과 대부분의 재질은 원본과 함께 쓰고, 도장 재질만 새로 만듭니다.
    const owned = new MeshPhysicalMaterial()
    const root = new Group()
    root.add(new Mesh(geometry, owned), new Mesh(geometry, material))
    const disposed: string[] = []
    geometry.addEventListener('dispose', () => disposed.push('geometry'))
    material.addEventListener('dispose', () => disposed.push('shared material'))
    owned.addEventListener('dispose', () => disposed.push('owned material'))

    // 바꿔 내린 뒤 들고 있을 것은 공유 형상·재질 하나씩뿐입니다(모델 트리 전체가 아님).
    expect(sharedResourcesOf(root)).toEqual([geometry, material])
    disposeObject(root, { keepShared: true })
    expect(disposed).toEqual(['owned material'])
    disposed.length = 0
    disposeObject(root)
    expect(disposed.sort()).toEqual(['geometry', 'geometry', 'owned material', 'shared material'])
  })
})
