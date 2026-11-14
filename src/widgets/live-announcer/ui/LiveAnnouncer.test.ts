import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionLogEntry, FleetFrame } from '@shared/api'
import { issueFixture, vehicleFixture } from '@shared/testing'
import LiveAnnouncer from './LiveAnnouncer.vue'

const frame = (log: ActionLogEntry[], issues = vehicleFixture.issues): FleetFrame => ({
  at: Date.UTC(2026, 10, 14, 4, 30, 0),
  timeScale: 12,
  vehicles: [{ ...vehicleFixture, issues }],
  log,
})

const entry = (phase: ActionLogEntry['phase'], message: string, id = `${phase}-1`): ActionLogEntry => ({
  id,
  vehicleId: 'kao-0001',
  issueId: issueFixture.id,
  action: 'cooling-mode',
  at: Date.UTC(2026, 10, 14, 4, 30, 0),
  phase,
  message,
})

const TIMEOUT = 'G80 · 냉각수 과열: 냉각 모드 명령에 2분 동안 차량 응답 없음'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('LiveAnnouncer', () => {
  it('처음 받은 프레임은 알리지 않고, 그 뒤 새 조치 완료는 status로, 조치 실패는 alert로 알립니다', async () => {
    const wrapper = mount(LiveAnnouncer, { props: { frame: frame([]) } })
    expect(wrapper.get('[role="status"]').text()).toBe('')
    expect(wrapper.get('[role="alert"]').text()).toBe('')

    await wrapper.setProps({ frame: frame([entry('completed', 'G80 · 냉각수 과열: 냉각 모드 완료')]) })
    await vi.advanceTimersByTimeAsync(100)
    expect(wrapper.get('[role="status"]').text()).toBe('G80 · 냉각수 과열: 냉각 모드 완료')
    expect(wrapper.get('[role="alert"]').text()).toBe('')

    await wrapper.setProps({ frame: frame([entry('failed', TIMEOUT), entry('completed', 'G80 · 냉각수 과열: 냉각 모드 완료')]) })
    await vi.advanceTimersByTimeAsync(100)
    expect(wrapper.get('[role="alert"]').text()).toBe(`실패: ${TIMEOUT}`)
  })

  it('같은 문구의 실패가 다시 오면 영역을 비웠다가 다시 채워 또 읽히게 합니다', async () => {
    const wrapper = mount(LiveAnnouncer, { props: { frame: frame([]) } })
    await wrapper.setProps({ frame: frame([entry('failed', TIMEOUT, 'a-timeout')]) })
    await vi.advanceTimersByTimeAsync(100)
    expect(wrapper.get('[role="alert"]').text()).toBe(`실패: ${TIMEOUT}`)

    // 같은 조치를 다시 보냈다가 또 응답이 없으면 id만 다르고 문구는 같습니다.
    await wrapper.setProps({ frame: frame([entry('failed', TIMEOUT, 'b-timeout'), entry('failed', TIMEOUT, 'a-timeout')]) })
    expect(wrapper.get('[role="alert"]').text()).toBe('')
    await vi.advanceTimersByTimeAsync(100)
    expect(wrapper.get('[role="alert"]').text()).toBe(`실패: ${TIMEOUT}`)
  })

  it('새 위험 등급 문제는 alert, 새 경고 문제는 status로 알립니다', async () => {
    const wrapper = mount(LiveAnnouncer, { props: { frame: frame([], []) } })
    await wrapper.setProps({ frame: frame([], [{ ...issueFixture, severity: 'critical' }]) })
    await vi.advanceTimersByTimeAsync(100)
    expect(wrapper.get('[role="alert"]').text()).toBe('위험: G80 냉각수 과열')
    await wrapper.setProps({ frame: frame([], [{ ...issueFixture, id: 'other', severity: 'warning' }]) })
    await vi.advanceTimersByTimeAsync(100)
    expect(wrapper.get('[role="status"]').text()).toBe('경고: G80 냉각수 과열')
  })
})
