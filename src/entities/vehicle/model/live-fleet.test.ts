import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FleetFrame } from '@shared/api'
import { HIDDEN_GRACE_MS, useLiveFleet } from './live-fleet'
import type { LiveFleetOptions } from './live-fleet'

class FakeEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  static instances: FakeEventSource[] = []
  readyState = FakeEventSource.CONNECTING
  closed = false
  private listeners = new Map<string, Array<(event: unknown) => void>>()

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  close() {
    this.readyState = FakeEventSource.CLOSED
    this.closed = true
  }

  frame(value: FleetFrame) {
    this.readyState = FakeEventSource.OPEN
    for (const listener of this.listeners.get('frame') ?? []) listener({ data: JSON.stringify(value) })
  }

  /** 서버가 200이 아닌 응답을 주면 EventSource는 CLOSED가 되고 error를 한 번 보냅니다. */
  fail(state = FakeEventSource.CLOSED) {
    this.readyState = state
    for (const listener of this.listeners.get('error') ?? []) listener(new Event('error'))
  }
}

const frameAt = (at: number): FleetFrame => ({ at, timeScale: 12, vehicles: [], log: [] })
const latest = () => FakeEventSource.instances.at(-1)!
let visibility: DocumentVisibilityState = 'visible'
const fetchMock = vi.fn()

function setVisibility(state: DocumentVisibilityState) {
  visibility = state
  document.dispatchEvent(new Event('visibilitychange'))
}

const mounted: Array<{ unmount: () => void }> = []

function mountFleet(options: LiveFleetOptions = {}) {
  let api!: ReturnType<typeof useLiveFleet>
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useLiveFleet(ref(frameAt(1000)), options)
        return () => h('div')
      },
    }),
  )
  mounted.push(wrapper)
  return { wrapper, api }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeEventSource.instances = []
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
})

afterEach(() => {
  // 앞 시험의 컴포넌트가 보이기 이벤트·타이머에 반응하지 않게 모두 떼어 냅니다.
  for (const wrapper of mounted.splice(0)) {
    try {
      wrapper.unmount()
    } catch {
      // 시험 안에서 이미 떼어 낸 컴포넌트
    }
  }
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useLiveFleet', () => {
  it('스트림 프레임으로 화면을 바꾸고 수신 중이 됩니다', () => {
    const { api } = mountFleet()
    expect(api.status.value).toBe('connecting')
    latest().frame(frameAt(2000))
    expect(api.frame.value?.at).toBe(2000)
    expect(api.status.value).toBe('live')
  })

  it('잠깐 끊기면(CONNECTING) EventSource가 스스로 다시 붙도록 둡니다', async () => {
    const { api } = mountFleet()
    latest().fail(FakeEventSource.CONNECTING)
    expect(api.status.value).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('세션이 끝나 스트림이 닫히면(401) 로그인 처리를 부르고 더 연결하지 않습니다', async () => {
    const onUnauthorized = vi.fn()
    mountFleet({ onUnauthorized })
    latest().fail()
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }))
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).toHaveBeenCalledWith('/api/fleet', expect.objectContaining({ cache: 'no-store' }))
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('서버 오류로 닫히면 점점 길게 기다리며 다시 받고, 받은 프레임을 바로 보여 준 뒤 스트림을 다시 엽니다', async () => {
    const { api } = mountFleet()
    latest().fail()
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // 두 번째는 2초 뒤
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(frameAt(5000)), { status: 200 }))
    await vi.advanceTimersByTimeAsync(1999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(api.frame.value?.at).toBe(5000)
    expect(FakeEventSource.instances).toHaveLength(2)
    latest().frame(frameAt(5500))
    expect(api.status.value).toBe('live')
  })

  it('탭을 1분 넘게 숨기면 스트림을 닫고, 다시 보이면 곧바로 받아 이어 갑니다', async () => {
    const { api } = mountFleet()
    const first = latest()
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(HIDDEN_GRACE_MS - 1)
    expect(first.closed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(first.closed).toBe(true)

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(frameAt(9000)), { status: 200 }))
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(api.frame.value?.at).toBe(9000)
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(latest().closed).toBe(false)
  })

  it('잠깐 숨겼다 돌아오면 스트림을 그대로 둡니다', async () => {
    mountFleet()
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(10_000)
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(HIDDEN_GRACE_MS)
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(latest().closed).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('화면을 떠나면 스트림을 닫고 다시 연결하지 않습니다', async () => {
    const { wrapper } = mountFleet()
    latest().fail()
    wrapper.unmount()
    expect(latest().closed).toBe(true)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
