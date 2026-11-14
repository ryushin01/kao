import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { ActionLogEntry, FleetFrame } from '@shared/api'
import { issueFixture, vehicleFixture } from '@shared/testing'
import LiveAnnouncer from './LiveAnnouncer.vue'

const frame = (log: ActionLogEntry[], issues = vehicleFixture.issues): FleetFrame => ({
  at: Date.UTC(2026, 10, 14, 4, 30, 0),
  timeScale: 12,
  vehicles: [{ ...vehicleFixture, issues }],
  log,
})

const entry = (phase: ActionLogEntry['phase'], message: string): ActionLogEntry => ({
  id: `${phase}-1`,
  vehicleId: 'kao-0001',
  issueId: issueFixture.id,
  action: 'cooling-mode',
  at: Date.UTC(2026, 10, 14, 4, 30, 0),
  phase,
  message,
})

describe('LiveAnnouncer', () => {
  it('처음 받은 프레임은 알리지 않고, 그 뒤 새 조치 완료는 status로, 조치 실패는 alert로 알립니다', async () => {
    const wrapper = mount(LiveAnnouncer, { props: { frame: frame([]) } })
    expect(wrapper.get('[role="status"]').text()).toBe('')
    expect(wrapper.get('[role="alert"]').text()).toBe('')

    await wrapper.setProps({ frame: frame([entry('completed', 'G80 · 냉각수 과열: 냉각 모드 완료')]) })
    expect(wrapper.get('[role="status"]').text()).toBe('G80 · 냉각수 과열: 냉각 모드 완료')
    expect(wrapper.get('[role="alert"]').text()).toBe('')

    await wrapper.setProps({
      frame: frame([entry('failed', 'G80 · 냉각수 과열: 냉각 모드 명령에 2분 동안 차량 응답 없음'), entry('completed', 'G80 · 냉각수 과열: 냉각 모드 완료')]),
    })
    expect(wrapper.get('[role="alert"]').text()).toBe('실패: G80 · 냉각수 과열: 냉각 모드 명령에 2분 동안 차량 응답 없음')
  })

  it('새 위험 등급 문제는 alert, 새 경고 문제는 status로 알립니다', async () => {
    const wrapper = mount(LiveAnnouncer, { props: { frame: frame([], []) } })
    await wrapper.setProps({ frame: frame([], [{ ...issueFixture, severity: 'critical' }]) })
    expect(wrapper.get('[role="alert"]').text()).toBe('위험: G80 냉각수 과열')
    await wrapper.setProps({ frame: frame([], [{ ...issueFixture, id: 'other', severity: 'warning' }]) })
    expect(wrapper.get('[role="status"]').text()).toBe('경고: G80 냉각수 과열')
  })
})
