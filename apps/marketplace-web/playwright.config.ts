import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  globalTeardown: './e2e/global-teardown.ts',
  outputDir: '../../output/playwright/results',
  reporter: [['list'], ['html', { outputFolder: '../../output/playwright/report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4320',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bun run build && bun e2e/server.ts',
    url: 'http://localhost:4320/agent/marketplace/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
