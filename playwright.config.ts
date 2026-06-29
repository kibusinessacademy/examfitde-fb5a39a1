// playwright.config.ts – ExamFit E2E Configuration
import { defineConfig, devices } from '@playwright/test';

// Resolve base URL with explicit named targets:
//   E2E_TARGET=production  → https://berufos.com
//   E2E_TARGET=preview     → preview deployment URL
//   E2E_TARGET=local       → http://localhost:8080
// Direct overrides (BASE_URL/STAGING_URL) still win for ad-hoc runs.
const TARGETS: Record<string, string> = {
  production: process.env.PRODUCTION_URL || 'https://berufos.com',
  preview: process.env.PREVIEW_URL || 'https://examfitde.lovable.app',
  local: process.env.LOCAL_URL || 'http://localhost:8080',
};
const target = (process.env.E2E_TARGET || '').toLowerCase();
const BASE_URL =
  process.env.BASE_URL ||
  process.env.STAGING_URL ||
  (target && TARGETS[target]) ||
  TARGETS.preview;

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
    {
      name: 'funnel-bridge',
      testMatch: /funnel-bridge-.*\.spec\.ts/,
      timeout: 90_000,
    },
    {
      name: 'event-inspector',
      testMatch: /event-inspector\.spec\.ts/,
      timeout: 60_000,
    },
    {
      name: 'ux-gap-bridge',
      testMatch: /ux-gap-bridge-ledger\.spec\.ts/,
      timeout: 90_000,
    },
    {
      name: 'mobile-overlap',
      testMatch: /mobile-banner-cta-overlap\.spec\.ts/,
      timeout: 60_000,
    },
    {
      name: 'pdp-hero-visual',
      testMatch: /pdp-hero-visual\.spec\.ts/,
      timeout: 120_000,
    },
    {
      name: 'b2b-render',
      testMatch: /b2b-route-render\.spec\.ts/,
      timeout: 60_000,
    },
    {
      name: 'mobile-screenshots',
      testMatch: /mobile-funnel-screenshots\.spec\.ts/,
      timeout: 180_000,
    },
    {
      name: 'customer-reality',
      testDir: './tests/customer-reality',
      testMatch: /.*\.spec\.ts$/,
      timeout: 90_000,
    },
    {
      name: 'learner-reality',
      testDir: './tests/customer-reality/learner',
      testMatch: /.*\.spec\.ts$/,
      timeout: 120_000,
    },
    {
      name: 'pre-customer-reality',
      testDir: './tests/customer-reality/precustomer',
      testMatch: /.*\.spec\.ts$/,
      timeout: 120_000,
    },
  ],
});
