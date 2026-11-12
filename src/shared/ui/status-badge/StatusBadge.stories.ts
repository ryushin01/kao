import type { Meta, StoryObj } from '@storybook/vue3-vite'
import StatusBadge from './StatusBadge.vue'

const meta = { title: 'shared/StatusBadge', component: StatusBadge } satisfies Meta<typeof StatusBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Nominal: Story = { args: { state: 'nominal' } }
export const Warning: Story = { args: { state: 'warning' } }
export const Critical: Story = { args: { state: 'critical' } }
