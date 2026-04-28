/**
 * E2E: Sales-Flow + AI-Tutor (Lovable Preview).
 *
 * Lokal ausführen:
 *   bun add -D @playwright/test
 *   bunx playwright install chromium
 *   E2E_BASE_URL="https://id-preview--ad51e8f9-6cff-41cf-9723-b4e49dbcd9db.lovable.app" \
 *   E2E_USER="user@example.com" E2E_PASS="..." \
 *   bunx playwright test e2e/sales-and-tutor.spec.ts
 *
 * Erwartung:
 *   1) /shop?curriculum=<id>  → Klick "Jetzt Prüfungstraining starten"
 *      ⇒ POST /functions/v1/create-checkout antwortet 200
 *   2) /drill?curriculum=<id> → Floating-Bot öffnen, Frage abschicken
 *      ⇒ POST /functions/v1/ai-tutor antwortet 200
 */
import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'https://id-preview--ad51e8f9-6cff-41cf-9723-b4e49dbcd9db.lovable.app';
const USER = process.env.E2E_USER ?? '';
const PASS = process.env.E2E_PASS ?? '';
const CURRICULUM = process.env.E2E_CURRICULUM ?? ''; // optional; falls leer wird der erste angeboten

test.skip(!USER || !PASS, 'E2E_USER und E2E_PASS müssen gesetzt sein.');

async function login(page: Page) {
  await page.goto(`${BASE}/auth`);
  await page.getByLabel(/e-?mail/i).fill(USER);
  await page.getByLabel(/passwort/i).fill(PASS);
  await page.getByRole('button', { name: /anmelden|login/i }).click();
  await page.waitForURL(/\/(home|dashboard|profile|index|drill|shop)?/i, { timeout: 15_000 });
}

test('Sales-Flow: create-checkout 200', async ({ page }) => {
  await login(page);
  const url = CURRICULUM ? `${BASE}/shop?curriculum=${CURRICULUM}` : `${BASE}/shop`;
  await page.goto(url);

  // Buy button
  const checkoutPromise = page.waitForResponse(
    (resp) => resp.url().includes('/functions/v1/create-checkout') && resp.request().method() === 'POST',
    { timeout: 20_000 },
  );
  await page.getByRole('button', { name: /jetzt.*starten|prüfungstraining starten/i }).first().click();
  const resp = await checkoutPromise;
  expect(resp.status(), `create-checkout returned ${resp.status()}`).toBe(200);
});

test('AI-Tutor in /drill: ai-tutor 200', async ({ page }) => {
  await login(page);
  const url = CURRICULUM ? `${BASE}/drill?curriculum=${CURRICULUM}` : `${BASE}/drill`;
  await page.goto(url);

  // Floating Bot
  await page.getByRole('button', { name: /ai-?tutor öffnen/i }).click();

  // Stelle eine Frage
  await page.getByPlaceholder(/frage stellen/i).fill('Was ist eine Normenhierarchie?');

  const tutorPromise = page.waitForResponse(
    (resp) => resp.url().includes('/functions/v1/ai-tutor') && resp.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await page.getByRole('button', { name: /senden|send/i }).click().catch(() => {
    // Fallback: Submit via Enter
    return page.keyboard.press('Enter');
  });

  const resp = await tutorPromise;
  expect(resp.status(), `ai-tutor returned ${resp.status()}`).toBe(200);
});
