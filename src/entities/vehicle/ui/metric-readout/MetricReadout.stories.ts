import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { metricFixture } from '@shared/testing'
import MetricReadout from './MetricReadout.vue'

const meta = { title: 'entities/vehicle/MetricReadout', component: MetricReadout } satisfies Meta<typeof MetricReadout>

export default meta
type Story = StoryObj<typeof meta>

export const Nominal: Story = { args: { metric: { ...metricFixture, value: 90.2, state: 'nominal' } } }
export const Warning: Story = { args: { metric: metricFixture } }
export const Critical: Story = { args: { metric: { ...metricFixture, value: 118.6, state: 'critical' } } }
export const Observed: Story = {
  args: { metric: { ...metricFixture, key: 'speed', label: '속도', unit: 'km/h', value: 72, max: 240, warn: null, crit: null, precision: 0, state: 'nominal' } },
}
