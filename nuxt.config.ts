import { fileURLToPath } from 'node:url'

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url))

export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  modules: ['@nuxt/eslint'],
  devtools: { enabled: false },
  // FSD 계층은 src/에 두고, Nuxt의 app/(라우트·진입점)은 src/를 다시 내보내기만 합니다.
  alias: {
    '@app': src('app'),
    '@pages': src('pages'),
    '@widgets': src('widgets'),
    '@features': src('features'),
    '@entities': src('entities'),
    '@shared': src('shared'),
  },
  // 컴포넌트·컴포저블은 자동 가져오기 대신 공개 API로 명시해서 가져옵니다.
  imports: { autoImport: false },
  components: { dirs: [] },
  css: ['@app/styles/index.css'],
  app: {
    head: {
      htmlAttrs: { lang: 'ko' },
      title: 'KAO — Kinetic Aero One',
      meta: [
        { name: 'description', content: '회원 탈것의 주행을 실시간으로 지켜보고, 문제가 생기면 원격으로 조치하는 관제 서비스' },
        { name: 'theme-color', content: '#000000' },
        { name: 'color-scheme', content: 'dark' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },
  eslint: { config: { stylistic: false } },
  typescript: { strict: true },
})
