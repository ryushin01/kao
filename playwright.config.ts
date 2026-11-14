import { defineConfig, devices } from '@playwright/test'

const PORT = 3100

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
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
