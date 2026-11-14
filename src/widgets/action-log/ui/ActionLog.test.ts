import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { ActionLogEntry } from '@shared/api'
import ActionLog from './ActionLog.vue'

const entry = (phase: ActionLogEntry['phase'], id: string): ActionLogEntry => ({
  id,
  vehicleId: 'kao-0001',
  issueId: 'live-kao-0001-coolant-1',
  action: 'cooling-mode',
  at: Date.UTC(2026, 10, 14, 4, 30, 0),
  phase,
  message: `메시지 ${id}`,
})

describe('ActionLog', () => {
  it('전송·완료·실패를 글자로 구분하고, 보이는 개수를 제한합니다', () => {
    const wrapper = mount(ActionLog, { props: { entries: [entry('failed', 'c'), entry('completed', 'b'), entry('sent', 'a')], limit: 2 } })
    const items = wrapper.findAll('li')
    expect(items).toHaveLength(2)
    expect(items.map((item) => item.get('.action-log__phase').text())).toEqual(['실패', '완료'])
    expect(items[0]!.attributes('data-phase')).toBe('failed')
    expect(items[0]!.text()).toContain('(냉각 모드)')
  })

  it('기록이 없으면 안내 문구를 보여 줍니다', () => {
    expect(mount(ActionLog, { props: { entries: [] } }).text()).toContain('아직 보낸 원격 조치가 없습니다.')
  })
})
