/**
 * Stripe Smoke — Pfad 2: create-product-checkout (B2C Single Purchase)
 *
 * Ziel:
 *   1) Login als Test-User
 *   2) Persona-Landing aufrufen und CTA klicken (UI-Pfad)
 *      Fallback: startProductCheckout direkt aus dem Browser-Kontext aufrufen
 *   3) Stripe Hosted Checkout mit 4242 ausfüllen
 *   4) Erfolg → session_id ableiten
 *   5) DB-Artefakte verifizieren (8x):
 *      orders → order_items → invoices → invoice_items →
 *      payments → ledger_entries → learner_course_grants → entitlements
 *
 * Ausführung:
 *   E2E_EMAIL=... E2E_PASSWORD=... \
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   [PRODUCT_SLUG=automatenfachmann-frau-c0ca4ef0] \
 *   bunx playwright test --project=stripe-smoke tests/e2e/stripe-smoke-product-checkout.spec.ts
 */
import { test, expect, Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAs } from './helpers/auth';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PRODUCT_SLUG =
  process.env.PRODUCT_SLUG || 'automatenfachmann-frau-c0ca4ef0';

if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error('SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required for stripe-smoke');
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function fillStripeCheckout(page: Page) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });

  const emailField = page.locator('input[type="email"]').first();
  if (await emailField.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await emailField.fill(process.env.E2E_EMAIL || 'smoke_no_entitlement@examfit.test');
  }

  const directNumber = page.locator('input[name="cardNumber"]');
  const useDirect = await directNumber.isVisible({ timeout: 4_000 }).catch(() => false);

  if (useDirect) {
    await directNumber.fill('4242 4242 4242 4242');
    await page.locator('input[name="cardExpiry"]').fill('12 / 34');
    await page.locator('input[name="cardCvc"]').fill('123');
  } else {
    const numberFrame = page.frameLocator('iframe[title*="card number" i], iframe[name*="card-number" i]').first();
    const expiryFrame = page.frameLocator('iframe[title*="expiration" i], iframe[name*="card-expiry" i]').first();
    const cvcFrame    = page.frameLocator('iframe[title*="CVC" i], iframe[title*="security code" i], iframe[name*="card-cvc" i]').first();
    await numberFrame.locator('input[name="cardnumber"], input[autocomplete="cc-number"]').fill('4242 4242 4242 4242');
    await expiryFrame.locator('input[name="exp-date"], input[autocomplete="cc-exp"]').fill('12 / 34');
    await cvcFrame.locator('input[name="cvc"], input[autocomplete="cc-csc"]').fill('123');
  }

  const nameField = page.locator('input[name="billingName"]');
  if (await nameField.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await nameField.fill('ExamFit Smoke Test');
  }
  const country = page.locator('select[name="billingCountry"]');
  if (await country.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await country.selectOption('DE');
  }

  await page.locator('button[type="submit"]').click();
}

/**
 * Browser-Kontext: ruft die Edge Function direkt mit der eingeloggten
 * Supabase-Session auf (so wie startProductCheckout es im Client tut).
 * Liefert die Stripe checkout_url zurück.
 */
async function invokeProductCheckoutInBrowser(
  page: Page,
  productSlug: string,
): Promise<string> {
  const checkoutUrl = await page.evaluate(async (slug) => {
    // dynamischer Import — Vite ist im Preview verfügbar
    const mod = await import('/src/integrations/supabase/client.ts');
    const { supabase } = mod as any;
    const { data, error } = await supabase.functions.invoke('create-product-checkout', {
      body: {
        product_slug: slug,
        source: 'stripe-smoke-pfad2',
        source_page: '/e2e/stripe-smoke',
      },
    });
    if (error) throw new Error('invoke error: ' + (error?.message || String(error)));
    if (!data?.ok || !data?.checkout_url) {
      throw new Error('no checkout_url: ' + JSON.stringify(data));
    }
    return data.checkout_url as string;
  }, productSlug);

  expect(checkoutUrl, 'checkout_url muss zurückkommen').toMatch(/^https:\/\/checkout\.stripe\.com/);
  return checkoutUrl;
}

test.describe('Stripe Smoke — create-product-checkout', () => {
  test.setTimeout(180_000);

  test(`Pfad 2: ${PRODUCT_SLUG} → Stripe → 8 Artefakte`, async ({ page }) => {
    // 1) Login (no-entitlement, sonst greift already_entitled)
    await loginAs(page, 'smoke_no_entitlement');

    // 2) Edge Function direkt aufrufen — deterministisch, unabhängig vom Landing-Layout
    const checkoutUrl = await invokeProductCheckoutInBrowser(page, PRODUCT_SLUG);
    await page.goto(checkoutUrl);

    // 3) Stripe ausfüllen
    await fillStripeCheckout(page);

    // 4) Erfolgsseite
    await page.waitForURL(/\/checkout\/success/, { timeout: 60_000 });
    const url = new URL(page.url());
    const sessionId = url.searchParams.get('session_id');
    expect(sessionId, 'session_id muss in der success-URL stehen').toMatch(/^cs_test_/);

    // Webhook-Settle-Window
    await page.waitForTimeout(6_000);

    // 5) Artefakte
    const { data: order, error: orderErr } = await admin
      .from('orders')
      .select('id, status, buyer_user_id, total_cents, currency, stripe_checkout_session_id')
      .eq('stripe_checkout_session_id', sessionId!)
      .maybeSingle();
    expect(orderErr).toBeNull();
    expect(order, 'orders-Row muss existieren').not.toBeNull();
    expect(order!.status).toBe('paid');
    expect(order!.total_cents).toBeGreaterThan(0);

    const orderId = order!.id;
    const buyerId = order!.buyer_user_id;

    // 5a) order_items → product_id muss zur products-Tabelle resolven
    const { data: items, error: itemsErr } = await admin
      .from('order_items')
      .select('id, product_id, quantity, unit_amount_cents')
      .eq('order_id', orderId);
    expect(itemsErr).toBeNull();
    expect(items?.length, 'order_items ≥1').toBeGreaterThanOrEqual(1);

    const productIds = (items || []).map((i) => i.product_id).filter(Boolean);
    if (productIds.length) {
      const { data: prods } = await admin
        .from('products')
        .select('id, slug')
        .in('id', productIds);
      expect(
        prods?.length,
        `order_items.product_id muss in products auflösbar sein (got ${prods?.length}/${productIds.length})`,
      ).toBe(productIds.length);
    }

    // 5b) Restliche Artefakte
    const checks: Record<string, () => Promise<number>> = {
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

    const results: Record<string, number> = { order_items: items?.length ?? 0 };
    for (const [name, fn] of Object.entries(checks)) {
      results[name] = await fn();
    }

    // 5c) Entitlement-Setup vollständig (alle has_*-Flags=true, valid_until in Zukunft)
    const { data: ents } = await admin
      .from('entitlements')
      .select('source, has_quiz, has_simulation, has_coach, has_oral, valid_until')
      .eq('user_id', buyerId)
      .order('granted_at', { ascending: false })
      .limit(5);
    const fresh = (ents || []).find(
      (e: any) =>
        e.has_quiz === true &&
        e.has_simulation === true &&
        e.has_coach === true &&
        e.has_oral === true &&
        new Date(e.valid_until) > new Date(),
    );
    expect(fresh, 'mindestens ein vollständiges aktives Entitlement muss vorhanden sein').toBeTruthy();

    // eslint-disable-next-line no-console
    console.log('[stripe-smoke pfad2] artifacts:', {
      order_id: orderId,
      session: sessionId,
      product_slug: PRODUCT_SLUG,
      ...results,
      entitlement_source: fresh?.source,
    });

    for (const [name, count] of Object.entries(results)) {
      expect(count, `${name} muss ≥1 Row haben`).toBeGreaterThanOrEqual(1);
    }
  });
});
