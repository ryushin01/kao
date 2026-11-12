import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  ignores: ['.output/**', '.nuxt/**', 'storybook-static/**', 'playwright-report/**', 'test-results/**'],
})
