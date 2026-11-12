import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { metricFixture } from '@shared/testing'
import MetricReadout from './MetricReadout.vue'

describe('MetricReadout', () => {
  it('값, 단위, 상태, 기준을 글자로 보여 줍니다', () => {
    const wrapper = mount(MetricReadout, { props: { metric: metricFixture } })
    expect(wrapper.text()).toContain('냉각수 온도')
    expect(wrapper.text()).toContain('108.4')
    expect(wrapper.text()).toContain('경고')
    expect(wrapper.text()).toContain('경고 105.0°C 이상 · 위험 115.0°C 이상')
  })

  it('기준이 없는 관찰 지표는 상태 배지를 그리지 않습니다', () => {
    const wrapper = mount(MetricReadout, {
      props: { metric: { ...metricFixture, key: 'speed', label: '속도', warn: null, crit: null, state: 'nominal' } },
    })
    expect(wrapper.find('.status-badge').exists()).toBe(false)
  })
})
