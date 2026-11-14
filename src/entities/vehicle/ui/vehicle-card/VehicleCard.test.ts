import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { vehicleFixture } from '@shared/testing'
import VehicleCard from './VehicleCard.vue'

describe('VehicleCard', () => {
  it('이름, 상태, 속도, 경로 진행, 열린 문제 수를 보여 줍니다', () => {
    const text = mount(VehicleCard, { props: { vehicle: vehicleFixture } }).text()
    expect(text).toContain('Genesis G80')
    expect(text).toContain('경고')
    expect(text).toContain('72km/h')
    expect(text).toContain('도심 순환로')
    expect(text).toContain('도심 순환로 · 정각부터')
    expect(text).toContain('3바퀴째 · 42%')
    expect(text).toContain('1건')
  })

  it('title 슬롯으로 제목을 링크로 바꿀 수 있습니다', () => {
    const wrapper = mount(VehicleCard, {
      props: { vehicle: vehicleFixture },
      slots: { title: '<a href="/fleet/kao-0001">Genesis G80</a>' },
    })
    expect(wrapper.get('h3 a').attributes('href')).toBe('/fleet/kao-0001')
  })
})
