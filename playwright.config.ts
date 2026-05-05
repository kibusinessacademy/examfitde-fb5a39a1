// playwright.config.ts – ExamFit E2E Configuration
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || process.env.STAGING_URL || 'https://examfitde.lovable.app';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH, args: ['--no-sandbox'] }
      : undefined,
  },
  projects: [
    {
      name: 'smoke',
      testMatch: /(smoke\.spec\.ts|learner-entitlement-flow\.spec\.ts|learner-minicheck-persistence\.spec\.ts)$/,
      timeout: 60_000,
    },
    {
      name: 'sanity',
      testMatch: /sanity\..*\.spec\.ts/,
      timeout: 60_000,
    },
    {
      name: 'nightly',
      testMatch: /nightly.*\.spec\.ts/,
      timeout: 300_000, // 5 min per test
    },
    {
      name: 'uat',
      testMatch: /uat\..*\.spec\.ts/,
      timeout: 120_000,
    },
    {
      name: 'stripe-smoke',
      testMatch: /stripe-smoke-.*\.spec\.ts/,
      timeout: 180_000,
    },
    {
      name: 'g3b',
      testMatch: /g3b\..*\.spec\.ts/,
      timeout: 90_000,
    },
  ],
});
