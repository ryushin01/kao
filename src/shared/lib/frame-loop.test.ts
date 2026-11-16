import { describe, expect, it, vi } from 'vitest'
import { createFrameLoop } from './frame-loop'
import type { FrameLoopOptions } from './frame-loop'

/** 예약한 콜백을 손으로 한 프레임씩 돌리는 가짜 requestAnimationFrame */
function fakeFrames() {
  let next = 1
  const queue = new Map<number, () => void>()
  return {
    schedule: (callback: () => void) => {
      queue.set(next, callback)
      return next++
    },
    cancel: (id: number) => void queue.delete(id),
    /** 지금 예약된 콜백을 한 번씩 돌립니다(그 사이 새로 예약된 것은 다음 프레임). */
    tick() {
      const due = [...queue.entries()]
      queue.clear()
      for (const [, callback] of due) callback()
    },
    get size() {
      return queue.size
    },
  }
}

function setup(options: Partial<FrameLoopOptions> = {}) {
  const frames = fakeFrames()
  const draw = vi.fn(options.draw ?? (() => {}))
  const loop = createFrameLoop({ ...options, draw, schedule: frames.schedule, cancel: frames.cancel })
  return { frames, draw, loop }
}

describe('createFrameLoop', () => {
  it('재생 중이고 보이면 매 프레임 그리고, 화면 밖으로 나가면 멈췄다가 돌아오면 다시 그립니다', () => {
    const { frames, draw, loop } = setup({ playing: false })
    loop.setPlaying(true)
    for (let i = 0; i < 3; i += 1) frames.tick()
    expect(draw).toHaveBeenCalledTimes(3)
    loop.setInView(false)
    frames.tick()
    for (let i = 0; i < 3; i += 1) frames.tick()
    const before = draw.mock.calls.length
    expect(loop.running).toBe(false)
    loop.setInView(true)
    frames.tick()
    frames.tick()
    expect(draw.mock.calls.length).toBe(before + 2)
  })

  it('다른 탭에서 돌아와도 화면 밖이면 그리지 않습니다', () => {
    const { frames, draw, loop } = setup()
    loop.setInView(false)
    loop.setPageVisible(false)
    frames.tick()
    const before = draw.mock.calls.length
    loop.setPageVisible(true)
    frames.tick()
    frames.tick()
    expect(draw.mock.calls.length).toBe(before)
  })

  it('화면 밖에서는 그릴 때마다 다시 요청하는 연쇄(자동 회전·따라가기의 change)가 이어지지 않습니다', () => {
    let request = () => {}
    const { frames, draw, loop } = setup({ playing: false, draw: () => request() })
    request = () => loop.invalidate()
    loop.invalidate()
    frames.tick()
    frames.tick()
    // 보이는 동안 멈춘 장면은 요청마다 다음 프레임에 한 번 더 그립니다(감속 중인 카메라).
    expect(draw).toHaveBeenCalledTimes(2)
    // 화면 밖으로 나가면 이미 예약된 프레임도 그리지 않고 연쇄가 끊깁니다.
    loop.setInView(false)
    for (let i = 0; i < 5; i += 1) frames.tick()
    expect(draw).toHaveBeenCalledTimes(2)
    expect(frames.size).toBe(0)
    // 다시 보이면 기억해 둔 요청을 한 번 그리며 이어 갑니다.
    loop.setInView(true)
    frames.tick()
    expect(draw).toHaveBeenCalledTimes(3)
  })

  it('반복 중에 그리는 동안 들어온 요청으로 같은 프레임을 두 번 그리지 않습니다', () => {
    let request = () => {}
    const { frames, draw, loop } = setup({ draw: () => request() })
    request = () => loop.invalidate()
    loop.resume()
    for (let i = 0; i < 4; i += 1) frames.tick()
    expect(draw).toHaveBeenCalledTimes(4)
    expect(frames.size).toBe(1)
  })

  it('멈추면 멈춘 모습을 한 번 그리고, 숨긴 동안의 요청은 다시 보일 때 한 번만 그립니다', () => {
    const { frames, draw, loop } = setup()
    loop.resume()
    frames.tick()
    loop.setPlaying(false)
    frames.tick()
    frames.tick()
    expect(draw).toHaveBeenCalledTimes(2)
    loop.setPageVisible(false)
    loop.invalidate()
    loop.invalidate()
    frames.tick()
    expect(draw).toHaveBeenCalledTimes(2)
    loop.setPageVisible(true)
    frames.tick()
    frames.tick()
    expect(draw).toHaveBeenCalledTimes(3)
  })

  it('그리는 중에 반복을 다시 시작해도 반복이 둘이 되지 않습니다', () => {
    let reenter = () => {}
    const { frames, draw, loop } = setup({ draw: () => reenter() })
    reenter = () => {
      loop.setPlaying(true)
      loop.resume()
    }
    loop.resume()
    for (let i = 0; i < 3; i += 1) {
      frames.tick()
      expect(frames.size).toBe(1)
    }
    expect(draw).toHaveBeenCalledTimes(3)
    loop.dispose()
    expect(frames.size).toBe(0)
  })

  it('반복을 다시 시작할 때 시계를 맞추고, 정리하면 예약을 모두 지웁니다', () => {
    const onStart = vi.fn()
    const { frames, loop } = setup({ onStart })
    loop.resume()
    expect(onStart).toHaveBeenCalledTimes(1)
    loop.dispose()
    expect(frames.size).toBe(0)
    loop.invalidate()
    loop.resume()
    expect(frames.size).toBe(0)
  })
})
