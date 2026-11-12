import type { Meta, StoryObj } from '@storybook/vue3-vite'
import HudPanel from './HudPanel.vue'

const meta = {
  title: 'shared/HudPanel',
  component: HudPanel,
  render: (args) => ({
    components: { HudPanel },
    setup: () => ({ args }),
    template: '<HudPanel v-bind="args" labelledby="panel-title"><h2 id="panel-title">조치 대기열</h2><p>모서리 괄호가 있는 HUD 패널입니다.</p></HudPanel>',
  }),
} satisfies Meta<typeof HudPanel>

export default meta
export const Default: StoryObj<typeof meta> = {}
