import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HistoryResponse } from '@shared/api'
import { metricFixture } from '@shared/testing'
import MetricHistory from './MetricHistory.vue'

const fetchHistory = vi.hoisted(() => vi.fn<(vehicleId: string, metric: string, minutes: number) => Promise<HistoryResponse>>())
vi.mock('@shared/api', async (original) => ({ ...(await original<typeof import('@shared/api')>()), fetchHistory }))

const to = Date.UTC(2026, 10, 14, 4, 30, 0)
const history = (liveSamples: number, points = 4): HistoryResponse => ({
  vehicleId: 'kao-0001',
  metric: metricFixture,
  from: to - 600_000,
  to,
  samples: Array.from({ length: points }, (_, i) => ({ at: to - (points - 1 - i) * 1000, value: 100 + i })),
  liveSamples,
})

afterEach(() => fetchHistory.mockReset())

describe('MetricHistory', () => {
  it('실차 측정값으로 채운 점이 있으면 몇 점인지 알려 줍니다', async () => {
    fetchHistory.mockResolvedValue(history(3))
    const wrapper = mount(MetricHistory, { props: { vehicleId: 'kao-0001', metrics: [metricFixture] } })
    await flushPromises()
    expect(fetchHistory).toHaveBeenCalledWith('kao-0001', 'coolant', 10)
    expect(wrapper.text()).toContain('그래프 4점 가운데 3점이 실차 측정값이고, 나머지는 시뮬레이션입니다.')
    wrapper.unmount()
  })

  it('모두 실측이면 그렇게, 모두 시뮬레이션이면 따로 알리지 않습니다', async () => {
    fetchHistory.mockResolvedValue(history(4))
    const live = mount(MetricHistory, { props: { vehicleId: 'kao-0001', metrics: [metricFixture] } })
    await flushPromises()
    expect(live.text()).toContain('그래프의 모든 점이 실차 측정값입니다.')
    live.unmount()

    fetchHistory.mockResolvedValue(history(0))
    const simulated = mount(MetricHistory, { props: { vehicleId: 'kao-0001', metrics: [metricFixture] } })
    await flushPromises()
    expect(simulated.text()).not.toContain('실차 측정값')
    simulated.unmount()
  })

  it('지표 셀렉트는 레이블과 연결하고, 직접 그린 화살표는 보조기기에서 숨깁니다', async () => {
    fetchHistory.mockResolvedValue(history(0))
    const wrapper = mount(MetricHistory, { props: { vehicleId: 'kao-0001', metrics: [metricFixture] } })
    await flushPromises()
    const select = wrapper.get('select')
    expect(wrapper.get(`label[for="${select.attributes('id')}"]`).text()).toBe('지표')
    expect(wrapper.get('.history__select svg').attributes('aria-hidden')).toBe('true')
    wrapper.unmount()
  })
})
