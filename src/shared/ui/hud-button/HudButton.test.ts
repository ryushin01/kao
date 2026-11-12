import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import HudButton from './HudButton.vue'

describe('HudButton', () => {
  it('기본은 type="button"이고 눌림 상태가 없으면 aria-pressed를 붙이지 않습니다', () => {
    const button = mount(HudButton, { slots: { default: '보내기' } }).get('button')
    expect(button.attributes('type')).toBe('button')
    expect(button.attributes('aria-pressed')).toBeUndefined()
  })

  it('토글 버튼이면 aria-pressed를 씁니다', () => {
    const button = mount(HudButton, { props: { pressed: true }, slots: { default: '정지' } }).get('button')
    expect(button.attributes('aria-pressed')).toBe('true')
  })
})
