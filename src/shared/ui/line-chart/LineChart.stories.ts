import type { Meta, StoryObj } from '@storybook/vue3-vite'
import LineChart from './LineChart.vue'

const start = Date.UTC(2026, 10, 12, 3, 0, 0)
const rising = Array.from({ length: 120 }, (_, i) => ({ at: start + i * 5000, value: 90 + Math.max(0, i - 40) * 0.3 + Math.sin(i / 3) * 0.6 }))

const meta = {
  title: 'shared/LineChart',
  component: LineChart,
  args: {
    samples: rising,
    label: '냉각수 온도 이력',
    unit: '°C',
    precision: 1,
    thresholds: [
      { value: 105, label: '경고 105.0', tone: 'warning' },
      { value: 115, label: '위험 115.0', tone: 'critical' },
    ],
  },
} satisfies Meta<typeof LineChart>

export default meta
type Story = StoryObj<typeof meta>

export const CrossingThresholds: Story = {}
export const Loading: Story = { args: { loading: true } }
export const Empty: Story = { args: { samples: [] } }
