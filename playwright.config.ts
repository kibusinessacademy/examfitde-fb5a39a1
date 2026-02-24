// playwright.config.ts – ExamFit E2E Configuration
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Sequential for stateful tests
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: process.env.STAGING_URL || 'https://examfitde.lovable.app',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'smoke',
      testMatch: /smoke\.spec\.ts/,
      timeout: 30_000,
    },
    {
      name: 'sanity',
      testMatch: /sanity\..*\.spec\.ts/,
      timeout: 60_000,
    },
    {
      name: 'uat',
      testMatch: /uat\..*\.spec\.ts/,
      timeout: 120_000,
    },
  ],
});
