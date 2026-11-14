import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import LineChart from './LineChart.vue'

const start = Date.UTC(2026, 10, 12, 3, 0, 0)
const samples = Array.from({ length: 5 }, (_, i) => ({ at: start + i * 60_000, value: 100 + i * 2 }))

describe('LineChart', () => {
  it('요약 문장과 표로 같은 값을 제공합니다', () => {
    const wrapper = mount(LineChart, { props: { samples, label: '냉각수 온도 이력', unit: '°C' } })
    expect(wrapper.get('figcaption').text()).toContain('최저 100°C, 최고 108°C, 마지막 108°C')
    expect(wrapper.findAll('tbody tr')).toHaveLength(5)
  })

  it('기준선을 색 선과 글자 라벨로 함께 그립니다', () => {
    const wrapper = mount(LineChart, {
      props: { samples, label: '냉각수', unit: '°C', thresholds: [{ value: 105, label: '경고 105', tone: 'warning' }] },
    })
    expect(wrapper.get('.chart__threshold--warning text').text()).toBe('경고 105')
  })

  it('화살표 키로 시각을 옮기면 툴팁과 읽기 문구가 따라갑니다', async () => {
    const wrapper = mount(LineChart, { props: { samples, label: '냉각수', unit: '°C' } })
    const plot = wrapper.get('[role="group"]')
    await plot.trigger('keydown', { key: 'End' })
    expect(wrapper.get('.chart__tooltip strong').text()).toBe('108°C')
    await plot.trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.get('.chart__tooltip strong').text()).toBe('106°C')
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('106°C')
    await plot.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.chart__tooltip').exists()).toBe(false)
  })
})
