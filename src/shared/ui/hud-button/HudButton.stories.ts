import type { Meta, StoryObj } from '@storybook/vue3-vite'
import HudButton from './HudButton.vue'

const meta = {
  title: 'shared/HudButton',
  component: HudButton,
  render: (args) => ({ components: { HudButton }, setup: () => ({ args }), template: '<HudButton v-bind="args">명령 보내기</HudButton>' }),
} satisfies Meta<typeof HudButton>

export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = { args: { variant: 'primary' } }
export const Ghost: Story = { args: { variant: 'ghost' } }
export const Pressed: Story = { args: { pressed: true } }
export const Disabled: Story = { args: { variant: 'primary', disabled: true } }
