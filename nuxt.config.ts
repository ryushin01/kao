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
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
    },
  },
  /**
   * 보안 헤더(모든 응답). 원격 조치·로그아웃 버튼이 있는 화면을 다른 사이트가 겹쳐 띄우지 못하게(클릭재킹) 하고,
   * MIME 추측·리퍼러·쓰지 않는 기기 권한을 막습니다. Nuxt가 설정 스크립트를 인라인으로 넣어 script-src까지 막는 CSP는 쓰지 않습니다.
   */
  routeRules: {
    '/**': {
      headers: {
        'content-security-policy': "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
        'cross-origin-opener-policy': 'same-origin',
      },
    },
  },
  eslint: { config: { stylistic: false } },
  typescript: {
    strict: true,
    // 앱에서 아직 가져오지 않은 파일(테스트, 픽스처, 스토리)도 타입 검사에 넣습니다.
    tsConfig: { include: ['../src/**/*', '../tests/**/*'] },
  },
  nitro: {
    // 서버 코드는 모두 명시적으로 가져옵니다.
    imports: false,
    vercel: {
      functions: {
        // DB(Neon)와 같은 싱가포르에서 실행합니다. 관제 스트림은 50초마다 닫고 다시 연결합니다.
        regions: ['sin1'],
        maxDuration: 60,
        supportsResponseStreaming: true,
      },
    },
  },
})
