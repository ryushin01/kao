import type { Meta, StoryObj } from '@storybook/vue3-vite'
import type { RemoteActionRequest, RemoteActionResponse } from '@shared/api'
import { issueFixture, vehicleFixture } from '@shared/testing'
import RemoteActionPanel from './RemoteActionPanel.vue'

const fakeSend = async (_vehicleId: string, body: RemoteActionRequest): Promise<RemoteActionResponse> => {
  await new Promise((resolve) => setTimeout(resolve, 600))
  return {
    entry: { id: 'log-1', vehicleId: 'kao-0001', issueId: body.issueId, action: body.action, at: Date.now(), phase: 'sent', message: '' },
    vehicle: vehicleFixture,
  }
}

const meta = {
  title: 'features/remote-action/RemoteActionPanel',
  component: RemoteActionPanel,
  args: { vehicleId: 'kao-0001', vehicleName: 'Genesis G80', issue: issueFixture, send: fakeSend },
} satisfies Meta<typeof RemoteActionPanel>

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {}
export const Critical: Story = { args: { issue: { ...issueFixture, severity: 'critical' } } }
export const Resolving: Story = { args: { issue: { ...issueFixture, status: 'resolving' } } }
export const Resolved: Story = {
  args: { issue: { ...issueFixture, status: 'resolved', resolvedBy: 'cooling-mode', resolvedAt: issueFixture.detectedAt + 90_000 } },
}
export const Failure: Story = {
  args: { send: async () => Promise.reject(new Error('이미 조치 중이거나 해결된 문제입니다. 목록을 새로 확인해 주세요.')) },
}
