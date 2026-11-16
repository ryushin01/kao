import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import VehicleShowcase from './VehicleShowcase.vue'

// WebGL을 쓸 수 있고 화면 가까이 온 것으로 두고, 3D 장면 조각은 받지 못한 것(배포 뒤 열려 있던 화면)으로 둡니다.
vi.mock('@shared/lib', async (original) => ({
  ...(await original<typeof import('@shared/lib')>()),
  isWebGLAvailable: () => true,
  whenNearViewport: (_element: Element, callback: () => void) => {
    callback()
    return () => {}
  },
}))
vi.mock('../lib/showcase-scene', () => {
  throw new TypeError('Failed to fetch dynamically imported module')
})

describe('VehicleShowcase', () => {
  it('3D 조각을 받지 못하면 그 자리에 새로 고침 안내와 버튼을 보이고, 돌리기 버튼은 숨깁니다', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    const wrapper = mount(VehicleShowcase, {
      props: { vehicle: { modelId: 'genesis-g80', paint: { name: 'Vik Black', hex: '#0e0f11' }, speed: 40, metrics: [], maker: 'Genesis' } },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('새 버전이 배포되어 3D 미니어처를 불러오지 못했습니다')
    expect(wrapper.find('canvas').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('왼쪽으로 돌리기')
    await wrapper.get('button').trigger('click')
    expect(reload).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    vi.unstubAllGlobals()
  })
})
