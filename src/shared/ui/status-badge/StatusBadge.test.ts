import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import StatusBadge from './StatusBadge.vue'

describe('StatusBadge', () => {
  it.each([
    ['nominal', '정상'],
    ['warning', '경고'],
    ['critical', '위험'],
  ] as const)('%s 상태를 글자(%s)로도 보여 줍니다', (state, label) => {
    const wrapper = mount(StatusBadge, { props: { state } })
    expect(wrapper.text()).toBe(label)
    expect(wrapper.classes()).toContain(`status-badge--${state}`)
  })

  it('label을 주면 기본 글자 대신 씁니다', () => {
    expect(mount(StatusBadge, { props: { state: 'nominal', label: '해결됨' } }).text()).toBe('해결됨')
  })
})
