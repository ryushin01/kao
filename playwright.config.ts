import { defineConfig, devices } from '@playwright/test'

const PORT = 3100

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  // GitHub CI(4코어)와 같은 조건이 되도록 CI에서는 브라우저 2개만 동시에 띄웁니다.
  // GPU 없이 WebGL을 CPU로 그리므로, 코어가 많은 기기에서 더 띄우면 서로 느려져 시간 초과가 납니다.
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  // 프로덕션 빌드로 검사합니다.
  webServer: {
    command: 'node .output/server/index.mjs',
    port: PORT,
    // 언제 열어도 조치할 문제가 있도록 문제를 자주 내는 시뮬레이션으로 띄웁니다.
    env: { PORT: String(PORT), NITRO_PORT: String(PORT), KAO_SIM_PROFILE: 'busy' },
    reuseExistingServer: false,
  },
})
