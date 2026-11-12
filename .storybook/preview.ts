import type { Preview } from '@storybook/vue3-vite'
import '../src/app/styles/index.css'

const preview: Preview = {
  parameters: {
    backgrounds: { disable: true },
    layout: 'padded',
  },
  decorators: [() => ({ template: '<div style="padding:1rem;background:#000;color:#f2efea;min-height:100%"><story /></div>' })],
}

export default preview
