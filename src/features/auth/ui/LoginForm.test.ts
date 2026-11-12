import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '@shared/api'
import LoginForm from './LoginForm.vue'

const user: SessionUser = { id: 'user-operator', login: 'operator', name: '관제 요원', role: 'operator', vehicleIds: [] }

describe('LoginForm', () => {
  it('빈 칸으로 내면 보내지 않고, 칸마다 원인과 고치는 방법을 연결합니다', async () => {
    const send = vi.fn()
    const wrapper = mount(LoginForm, { props: { send }, attachTo: document.body })
    await wrapper.get('form').trigger('submit')
    const loginInput = wrapper.get('input[name="username"]')
    expect(loginInput.attributes('aria-invalid')).toBe('true')
    const describedBy = loginInput.attributes('aria-describedby')!
    expect(wrapper.get(`[id="${describedBy}"]`).text()).toContain('아이디를 입력해 주세요')
    expect(send).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('입력란은 자동 완성을 막지 않습니다', () => {
    const wrapper = mount(LoginForm)
    expect(wrapper.get('input[name="username"]').attributes('autocomplete')).toBe('username')
    expect(wrapper.get('input[type="password"]').attributes('autocomplete')).toBe('current-password')
  })

  it('데모 계정 버튼을 빠르게 두 번 눌러도 한 번만 보냅니다', async () => {
    let resolve!: (value: { user: SessionUser }) => void
    const send = vi.fn(() => new Promise<{ user: SessionUser }>((r) => (resolve = r)))
    const wrapper = mount(LoginForm, { props: { send } })
    const demo = wrapper.findAll('.login__demo button')[0]!
    await Promise.all([demo.trigger('click'), demo.trigger('click')])
    resolve({ user })
    await flushPromises()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ login: 'operator', password: 'kao-demo-2026' })
    expect(wrapper.emitted('success')).toEqual([[user]])
  })

  it('틀리면 서버의 안내를 role="alert"로 알리고 다시 시도할 수 있습니다', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('아이디 또는 비밀번호가 맞지 않습니다.')).mockResolvedValueOnce({ user })
    const wrapper = mount(LoginForm, { props: { send } })
    await wrapper.get('input[name="username"]').setValue('operator')
    await wrapper.get('input[type="password"]').setValue('x')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('아이디 또는 비밀번호가 맞지 않습니다.')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(send).toHaveBeenCalledTimes(2)
  })
})
