import { Page, expect } from "@playwright/test";

/**
 * Login as the E2E test user.
 * Reads E2E_EMAIL and E2E_PASSWORD from env.
 */
export async function login(page: Page) {
  const email = process.env.E2E_EMAIL ?? "";
  const password = process.env.E2E_PASSWORD ?? "";
  if (!email || !password) throw new Error("Missing E2E_EMAIL/E2E_PASSWORD env vars");

  await page.goto("/auth");
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');

  // Wait for redirect away from auth page
  await page.waitForURL((url) => !url.pathname.includes("/auth"), { timeout: 15_000 });
}

/**
 * Get env variable with fallback.
 */
export function env(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}
