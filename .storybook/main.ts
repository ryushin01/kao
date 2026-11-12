import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import type { StorybookConfig } from '@storybook/vue3-vite'

const src = (path: string) => fileURLToPath(new URL(`../src/${path}`, import.meta.url))

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.ts'],
  framework: { name: '@storybook/vue3-vite', options: {} },
  async viteFinal(viteConfig) {
    viteConfig.resolve ??= {}
    viteConfig.resolve.alias = {
      ...(viteConfig.resolve.alias as Record<string, string>),
      '@shared': src('shared'),
      '@entities': src('entities'),
      '@features': src('features'),
      '@widgets': src('widgets'),
    }
    viteConfig.plugins = [...(viteConfig.plugins ?? []), vue()]
    return viteConfig
  },
}

export default config
