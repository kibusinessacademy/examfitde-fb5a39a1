/**
 * Stripe Smoke — Pfad 1: paywall_variant via /preise
 *
 * Voller End-to-End-Lauf:
 *   1) Login als Test-User
 *   2) /preise öffnen, paywall_variant CTA klicken
 *   3) Stripe-Checkout (Test-Mode) mit 4242-Karte ausfüllen
 *   4) Warten bis Redirect zurück nach /checkout/success
 *   5) stripe_session_id aus URL extrahieren
 *   6) Über Service-Role alle 8 Artefakte verifizieren:
 *      orders → order_items → invoices → invoice_items →
 *      payments → ledger_entries → learner_course_grants → entitlements
 *
 * Ausführung:
 *   E2E_EMAIL=... E2E_PASSWORD=... \
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   BASE_URL=https://examfitde.lovable.app \
 *   bunx playwright test --project=stripe-smoke
 */
import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAs } from './helpers/auth';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error('SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required for stripe-smoke');
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function fillStripeCheckout(page: Page) {
  // Stripe Checkout läuft auf checkout.stripe.com — eigener Origin, eigene iframes erlaubt.
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });

  // Email (falls Stripe danach fragt — guest-checkout-Pfad)
  const emailField = page.locator('input[type="email"]').first();
  if (await emailField.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await emailField.fill(process.env.E2E_EMAIL || 'smoke_with_entitlement@examfit.test');
  }

  // Karten-Felder (Stripe rendert direkt im DOM, nicht in iframes auf der Hosted-Page)
  await page.locator('input[name="cardNumber"]').fill('4242 4242 4242 4242');
  await page.locator('input[name="cardExpiry"]').fill('12 / 34');
  await page.locator('input[name="cardCvc"]').fill('123');

  const nameField = page.locator('input[name="billingName"]');
  if (await nameField.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await nameField.fill('ExamFit Smoke Test');
  }

  // Land (DE) wenn vorhanden
  const country = page.locator('select[name="billingCountry"]');
  if (await country.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await country.selectOption('DE');
  }

  // Submit
  await page.locator('button[type="submit"]').click();
}

test.describe('Stripe Smoke — paywall_variant', () => {
  test.setTimeout(180_000);

  test('Pfad 1: /preise → 4242 → 8 Artefakte', async ({ page }) => {
    // 1) Login
    await loginAs(page, 'smoke_no_entitlement');

    // 2) /preise öffnen
    await page.goto('/preise');
    await page.waitForLoadState('networkidle');

    // 3) ersten paywall-CTA klicken (data-testid bevorzugt, Fallback Text)
    const cta = page
      .locator('[data-testid="paywall-cta"], [data-testid="checkout-cta"]')
      .first();
    if (await cta.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await cta.click();
    } else {
      await page.getByRole('button', { name: /jetzt|kaufen|starten|freischalten/i }).first().click();
    }

    // 4) Stripe Checkout ausfüllen
    await fillStripeCheckout(page);

    // 5) Erfolgsseite — Webhook hat Zeit bis hierhin
    await page.waitForURL(/\/checkout\/success/, { timeout: 60_000 });
    const url = new URL(page.url());
    const sessionId = url.searchParams.get('session_id');
    expect(sessionId, 'session_id muss in der success-URL stehen').toMatch(/^cs_test_/);

    // Webhook-Settle-Window
    await page.waitForTimeout(5_000);

    // 6) Artefakt-Verifikation
    const { data: order, error: orderErr } = await admin
      .from('orders')
      .select('id, status, buyer_user_id, total_amount_cents, currency, stripe_checkout_session_id')
      .eq('stripe_checkout_session_id', sessionId!)
      .maybeSingle();
    expect(orderErr).toBeNull();
    expect(order, 'orders-Row muss existieren').not.toBeNull();
    expect(order!.status).toBe('paid');

    const orderId = order!.id;
    const buyerId = order!.buyer_user_id;

    const checks: Record<string, () => Promise<number>> = {
      order_items: async () =>
        (await admin.from('order_items').select('id', { count: 'exact', head: true }).eq('order_id', orderId)).count ?? 0,
      invoices: async () =>
        (await admin.from('invoices').select('id', { count: 'exact', head: true }).eq('order_id', orderId)).count ?? 0,
      invoice_items: async () => {
        const { data: invs } = await admin.from('invoices').select('id').eq('order_id', orderId);
        if (!invs?.length) return 0;
        const { count } = await admin
          .from('invoice_items')
          .select('id', { count: 'exact', head: true })
          .in('invoice_id', invs.map((i) => i.id));
        return count ?? 0;
      },
      payments: async () =>
        (await admin.from('payments').select('id', { count: 'exact', head: true }).eq('order_id', orderId)).count ?? 0,
      ledger_entries: async () =>
        (await admin.from('ledger_entries').select('id', { count: 'exact', head: true }).eq('order_id', orderId)).count ?? 0,
      learner_course_grants: async () =>
        (await admin.from('learner_course_grants').select('id', { count: 'exact', head: true }).eq('user_id', buyerId)).count ?? 0,
      entitlements: async () =>
        (await admin.from('entitlements').select('id', { count: 'exact', head: true }).eq('user_id', buyerId)).count ?? 0,
    };

    const results: Record<string, number> = {};
    for (const [name, fn] of Object.entries(checks)) {
      results[name] = await fn();
    }

    // eslint-disable-next-line no-console
    console.log('[stripe-smoke] artifacts:', { order_id: orderId, session: sessionId, ...results });

    for (const [name, count] of Object.entries(results)) {
      expect(count, `${name} muss ≥1 Row haben`).toBeGreaterThanOrEqual(1);
    }
  });
});
