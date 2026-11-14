import { flushPromises, mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { RemoteActionResponse } from '@shared/api'
import { issueFixture, vehicleFixture } from '@shared/testing'
import RemoteActionPanel from './RemoteActionPanel.vue'

beforeAll(() => {
  // happy-dom의 dialog가 모달을 열고 닫는 최소 동작만 갖추게 합니다.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

const response: RemoteActionResponse = {
  entry: { id: 'log-1', vehicleId: 'kao-0001', issueId: issueFixture.id, action: 'cooling-mode', at: 0, phase: 'sent', message: '' },
  vehicle: { ...vehicleFixture, issues: [{ ...issueFixture, status: 'resolving' }] },
}

function setup(send = vi.fn(async () => response)) {
  const wrapper = mount(RemoteActionPanel, {
    props: { vehicleId: 'kao-0001', vehicleName: 'Genesis G80', issue: issueFixture, send },
    attachTo: document.body,
  })
  return { wrapper, send }
}

describe('RemoteActionPanel', () => {
  it('회원 화면(readonly)에서는 조치 버튼 없이 안내만 보여 줍니다', () => {
    const wrapper = mount(RemoteActionPanel, {
      props: { vehicleId: 'kao-0001', vehicleName: 'Genesis G80', issue: issueFixture, readonly: true },
    })
    expect(wrapper.find('.issue__actions').exists()).toBe(false)
    expect(wrapper.text()).toContain('원격 조치는 관제 요원이 보냅니다')
  })

  it('제안된 조치를 버튼으로 보여 주고, 각 버튼에 설명을 연결합니다', () => {
    const { wrapper } = setup()
    const buttons = wrapper.findAll('.issue__actions button')
    expect(buttons.map((b) => b.text())).toEqual(['냉각 모드', '출력 제한', '긴급 출동'])
    const describedBy = buttons[0]!.attributes('aria-describedby')!
    expect(wrapper.find(`[id="${describedBy}"]`).text()).toContain('냉각 팬')
  })

  it('확인 대화상자에서 보내기를 눌러야 명령을 보냅니다', async () => {
    const { wrapper, send } = setup()
    await wrapper.findAll('.issue__actions button')[0]!.trigger('click')
    const dialog = wrapper.get('dialog')
    expect(dialog.attributes('open')).toBeDefined()
    expect(dialog.attributes('role')).toBe('alertdialog')
    expect(dialog.text()).toContain('냉각 모드 명령을 보낼까요?')
    expect(send).not.toHaveBeenCalled()

    await dialog.findAll('button').find((b) => b.text() === '명령 보내기')!.trigger('click')
    await flushPromises()
    expect(send).toHaveBeenCalledWith('kao-0001', { issueId: issueFixture.id, action: 'cooling-mode' })
    expect(wrapper.get('[role="status"]').text()).toContain('냉각 모드 명령을 보냈습니다')
    expect(wrapper.emitted('success')).toHaveLength(1)
    wrapper.unmount()
  })

  it('보내기를 빠르게 두 번 눌러도 명령은 한 번만 갑니다', async () => {
    let resolve!: (value: RemoteActionResponse) => void
    const send = vi.fn(() => new Promise<RemoteActionResponse>((r) => (resolve = r)))
    const { wrapper } = setup(send)
    await wrapper.findAll('.issue__actions button')[0]!.trigger('click')
    const confirm = wrapper.get('dialog').findAll('button').find((b) => b.text() === '명령 보내기')!
    await Promise.all([confirm.trigger('click'), confirm.trigger('click'), confirm.trigger('dblclick')])
    await flushPromises()
    resolve(response)
    await flushPromises()
    expect(send).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('실패하면 원인을 role="alert"로 알리고 다시 보낼 수 있게 풉니다', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('이미 조치 중이거나 해결된 문제입니다.'))
      .mockResolvedValueOnce(response)
    const { wrapper } = setup(send)
    const sendOnce = async () => {
      await wrapper.findAll('.issue__actions button')[1]!.trigger('click')
      await wrapper.get('dialog').findAll('button').find((b) => b.text() === '명령 보내기')!.trigger('click')
      await flushPromises()
    }
    await sendOnce()
    expect(wrapper.get('[role="alert"]').text()).toBe('이미 조치 중이거나 해결된 문제입니다.')
    await sendOnce()
    expect(send).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
})
