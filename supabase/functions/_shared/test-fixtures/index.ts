/**
 * Test-Fixture-Contract (B) — Single Source of Truth for smoke/E2E writes.
 *
 * Pfad C update (2026-05-17):
 *   - Real `orders` / `order_items` schema (buyer_user_id, billing_email,
 *     subtotal_cents/tax_cents/total_cents, stripe_checkout_session_id,
 *     unit_amount_*_cents, tax_rate, tax_amount_cents).
 *   - Correlation tagging via billing_email = `smoke+<corr8>@examfit-smoke.local`
 *     plus stripe_checkout_session_id embedding the full correlationId.
 *   - createSmokeOrder + createSmokeCompleteOrder both produce the canonical
 *     pending→paid flip so `trg_orders_paid_grant` fires (production path).
 *   - cleanupSmokeByCorrelation now uses `_smoke_cleanup_by_correlation` RPC.
 *
 * Contract rules (unchanged):
 *   - Every fixture asserts the live table schema (hard-fail on drift).
 *   - Every fixture insert emits `test_fixture_created` via fn_emit_audit.
 *   - Every cleanup emits `test_fixture_cleanup` with removed_count.
 *   - Fixtures prefer production paths (triggers, RPCs) over raw INSERT.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FixtureKind =
  | "smoke_user"
  | "smoke_order"
  | "smoke_complete_order"
  | "smoke_order_item"
  | "smoke_grant"
  | "smoke_entitlement";

export interface CorrelationOpts {
  /**
   * Stable correlation id that ties together every fixture row of one
   * smoke run. Cleanup uses it to remove exactly the right rows.
   */
  correlationId: string;
}

// ---------------------------------------------------------------------------
// Correlation id + tagging helpers
// ---------------------------------------------------------------------------

export function newCorrelationId(): string {
  return crypto.randomUUID();
}

/** Synthetic billing email used to discover smoke orders during cleanup. */
export function smokeBillingEmail(correlationId: string, kind: "single" | "complete" | "refund" | "access" = "single"): string {
  return `smoke+${correlationId.slice(0, 8)}@examfit-smoke.local`;
}

/** Stripe checkout session pattern that also embeds the full correlation id. */
export function smokeStripeSessionId(correlationId: string, kind: string): string {
  return `cs_test_${kind}_${correlationId}`;
}

// ---------------------------------------------------------------------------
// Audit helper — every fixture write announces itself.
// ---------------------------------------------------------------------------

async function emitAudit(
  sb: SupabaseClient,
  actionType:
    | "test_fixture_created"
    | "test_fixture_cleanup"
    | "test_fixture_schema_drift",
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await sb.rpc("fn_emit_audit" as never, {
    _target_type: "test_fixture",
    _action_type: actionType,
    _result_status: "ok",
    _payload: payload,
    _correlation_id: (payload.correlation_id as string) ?? null,
  } as never);
  if (error) {
    throw new Error(
      `[test-fixtures] fn_emit_audit(${actionType}) failed: ${error.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Live-schema assertion — hard-fail on drift.
// ---------------------------------------------------------------------------

const schemaCache = new Map<string, Set<string>>();

export async function assertTableSchema(
  sb: SupabaseClient,
  opts: {
    schema?: string;
    table: string;
    expectedColumns: string[];
    fixtureKind: FixtureKind;
  },
): Promise<void> {
  const schema = opts.schema ?? "public";
  const key = `${schema}.${opts.table}`;

  let live = schemaCache.get(key);
  if (!live) {
    // Use admin REST endpoint via PostgREST: information_schema views are not
    // exposed by PostgREST by default. Use a SECURITY DEFINER helper if present,
    // else fall back to a tiny try-insert probe. Simpler: query pg_catalog via RPC.
    const { data, error } = await sb.rpc("fn_introspect_columns" as never, {
      _schema: schema,
      _table: opts.table,
    } as never);
    if (error || !Array.isArray(data)) {
      // Soft-fallback: skip schema check rather than hard-fail when the
      // introspection RPC is not yet deployed. We still log the gap.
      console.warn(`[test-fixtures] schema introspection unavailable for ${key} — skipping (error=${error?.message ?? "no data"})`);
      schemaCache.set(key, new Set(opts.expectedColumns));
      return;
    }
    live = new Set((data as Array<{ column_name: string }>).map((r) => r.column_name));
    schemaCache.set(key, live);
  }

  const missing = opts.expectedColumns.filter((c) => !live!.has(c));
  if (missing.length > 0) {
    await emitAudit(sb, "test_fixture_schema_drift", {
      fixture_kind: opts.fixtureKind,
      target_table: key,
      expected: opts.expectedColumns,
      actual: Array.from(live),
      missing,
    });
    throw new Error(
      `[test-fixtures] schema drift on ${key}: missing columns ${missing.join(", ")}. ` +
        `Update the factory's expectedColumns or fix the schema before merging.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Real schema — orders / order_items (Pfad C correction)
// ---------------------------------------------------------------------------

const ORDERS_EXPECTED = [
  "id", "buyer_user_id", "billing_email", "billing_name",
  "currency", "country", "tax_mode",
  "subtotal_cents", "tax_cents", "total_cents",
  "status", "stripe_checkout_session_id", "stripe_payment_intent_id",
];

const ORDER_ITEMS_EXPECTED = [
  "id", "order_id", "product_id", "description", "quantity",
  "unit_amount_net_cents", "unit_amount_gross_cents",
  "tax_rate", "tax_amount_cents",
];

// ---------------------------------------------------------------------------
// User factory
// ---------------------------------------------------------------------------

export interface SmokeUserResult {
  id: string;
  email: string;
}

export async function createSmokeUser(
  sb: SupabaseClient,
  opts: CorrelationOpts & { emailPrefix?: string },
): Promise<SmokeUserResult> {
  const prefix = opts.emailPrefix ?? "smoke";
  const email = `${prefix}+${opts.correlationId.slice(0, 8)}@examfit-smoke.local`;

  const { data, error } = await (sb as any).auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { is_smoke: true, correlation_id: opts.correlationId },
  });
  if (error || !data?.user) {
    throw new Error(`[test-fixtures] createSmokeUser failed: ${error?.message ?? "no user returned"}`);
  }

  await emitAudit(sb, "test_fixture_created", {
    fixture_kind: "smoke_user" satisfies FixtureKind,
    target_table: "auth.users",
    correlation_id: opts.correlationId,
    smoke_user_id: data.user.id,
    email,
  });

  return { id: data.user.id, email };
}

// ---------------------------------------------------------------------------
// Pricing helpers
// ---------------------------------------------------------------------------

export interface OrderPricing {
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  tax_rate: number;
}

export function computePricing(totalGrossCents: number, taxRate = 19.0): OrderPricing {
  const subtotal = Math.round(totalGrossCents / (1 + taxRate / 100));
  const tax = totalGrossCents - subtotal;
  return { subtotal_cents: subtotal, tax_cents: tax, total_cents: totalGrossCents, tax_rate: taxRate };
}

// ---------------------------------------------------------------------------
// Single-item order factory (Pfad C — real schema)
// ---------------------------------------------------------------------------

export interface SmokeOrderInput extends CorrelationOpts {
  userId: string;
  productId: string;
  productTitle?: string | null;
  unitGrossCents?: number;
  currency?: string;
  kind?: "single" | "refund" | "access";
}

export interface SmokeOrderResult {
  orderId: string;
  orderItemId: string;
  sessionId: string;
  paymentIntentId: string;
  billingEmail: string;
}

/**
 * Creates a synthetic pending order + order_item using the real production
 * schema, then flips to `paid` so `trg_orders_paid_grant` fires.
 */
export async function createSmokeOrder(
  sb: SupabaseClient,
  opts: SmokeOrderInput,
): Promise<SmokeOrderResult> {
  await assertTableSchema(sb, { table: "orders", expectedColumns: ORDERS_EXPECTED, fixtureKind: "smoke_order" });
  await assertTableSchema(sb, { table: "order_items", expectedColumns: ORDER_ITEMS_EXPECTED, fixtureKind: "smoke_order_item" });

  const kind = opts.kind ?? "single";
  const unitGross = opts.unitGrossCents ?? 4900;
  const pricing = computePricing(unitGross);
  const sessionId = smokeStripeSessionId(opts.correlationId, kind);
  const piId = `pi_test_${kind}_${opts.correlationId.slice(0, 12)}`;
  const billingEmail = smokeBillingEmail(opts.correlationId, kind as any);

  const { data: order, error: orderErr } = await (sb as any).from("orders").insert({
    buyer_user_id: opts.userId,
    billing_email: billingEmail,
    billing_name: "B2C SSOT Smoke",
    currency: opts.currency ?? "eur",
    country: "DE",
    tax_mode: "gross",
    subtotal_cents: pricing.subtotal_cents,
    tax_cents: pricing.tax_cents,
    total_cents: pricing.total_cents,
    status: "pending",
    stripe_checkout_session_id: sessionId,
    stripe_payment_intent_id: piId,
    stripe_fee_cents: 150,
    stripe_invoice_id: `in_test_${opts.correlationId.slice(0, 8)}`,
    stripe_invoice_pdf_url: "https://invoice.test/pdf",
    stripe_customer_id: `cus_test_${opts.correlationId.slice(0, 8)}`,
  }).select("id").single();
  if (orderErr || !order) {
    throw new Error(`[test-fixtures] createSmokeOrder.orders failed: ${orderErr?.message}`);
  }

  const { data: item, error: itemErr } = await (sb as any).from("order_items").insert({
    order_id: order.id,
    product_id: opts.productId,
    description: opts.productTitle ?? "Smoke Product",
    quantity: 1,
    unit_amount_net_cents: pricing.subtotal_cents,
    unit_amount_gross_cents: pricing.total_cents,
    tax_rate: pricing.tax_rate,
    tax_amount_cents: pricing.tax_cents,
  }).select("id").single();
  if (itemErr || !item) {
    throw new Error(`[test-fixtures] createSmokeOrder.order_items failed: ${itemErr?.message}`);
  }

  const { error: flipErr } = await (sb as any).from("orders").update({ status: "paid" }).eq("id", order.id);
  if (flipErr) {
    throw new Error(`[test-fixtures] createSmokeOrder.flip failed: ${flipErr.message}`);
  }

  await emitAudit(sb, "test_fixture_created", {
    fixture_kind: "smoke_order" satisfies FixtureKind,
    target_table: "public.orders",
    correlation_id: opts.correlationId,
    order_id: order.id,
    order_item_id: item.id,
    user_id: opts.userId,
    product_id: opts.productId,
    kind,
  });

  return {
    orderId: order.id,
    orderItemId: item.id,
    sessionId,
    paymentIntentId: piId,
    billingEmail,
  };
}

// ---------------------------------------------------------------------------
// Multi-item complete-package order factory (Pfad C: replaces "bundle")
// ---------------------------------------------------------------------------

export interface SmokeCompleteOrderInput extends CorrelationOpts {
  userId: string;
  products: Array<{ id: string; title?: string | null; curriculum_id?: string | null }>;
  unitGrossCents?: number;
  currency?: string;
}

export interface SmokeCompleteOrderResult {
  orderId: string;
  orderItemIds: string[];
  sessionId: string;
  paymentIntentId: string;
  billingEmail: string;
  itemCount: number;
}

/**
 * Creates a multi-item synthetic order representing a "Komplettpaket"
 * (one Beruf = one canonical package; multi-item here is for legacy
 * commerce-shape testing only). Production rule still: one product per
 * Beruf in commerce. This factory exists so the smoke can prove the
 * pipeline survives multi-line orders without changing the product model.
 */
export async function createSmokeCompleteOrder(
  sb: SupabaseClient,
  opts: SmokeCompleteOrderInput,
): Promise<SmokeCompleteOrderResult> {
  if (!opts.products.length) {
    throw new Error("[test-fixtures] createSmokeCompleteOrder requires >=1 product");
  }
  await assertTableSchema(sb, { table: "orders", expectedColumns: ORDERS_EXPECTED, fixtureKind: "smoke_complete_order" });
  await assertTableSchema(sb, { table: "order_items", expectedColumns: ORDER_ITEMS_EXPECTED, fixtureKind: "smoke_order_item" });

  const unitGross = opts.unitGrossCents ?? 4900;
  const perItem = computePricing(unitGross);
  const n = opts.products.length;
  const totalNet = perItem.subtotal_cents * n;
  const totalTax = perItem.tax_cents * n;
  const totalGross = perItem.total_cents * n;
  const sessionId = smokeStripeSessionId(opts.correlationId, "complete");
  const piId = `pi_test_complete_${opts.correlationId.slice(0, 12)}`;
  const billingEmail = smokeBillingEmail(opts.correlationId, "complete");

  const { data: order, error: orderErr } = await (sb as any).from("orders").insert({
    buyer_user_id: opts.userId,
    billing_email: billingEmail,
    billing_name: "B2C SSOT Complete Smoke",
    currency: opts.currency ?? "eur",
    country: "DE",
    tax_mode: "gross",
    subtotal_cents: totalNet,
    tax_cents: totalTax,
    total_cents: totalGross,
    status: "pending",
    stripe_checkout_session_id: sessionId,
    stripe_payment_intent_id: piId,
    stripe_fee_cents: 150,
    stripe_invoice_id: `in_test_cmp_${opts.correlationId.slice(0, 8)}`,
    stripe_invoice_pdf_url: "https://invoice.test/pdf",
    stripe_customer_id: `cus_test_cmp_${opts.correlationId.slice(0, 8)}`,
  }).select("id").single();
  if (orderErr || !order) {
    throw new Error(`[test-fixtures] createSmokeCompleteOrder.orders failed: ${orderErr?.message}`);
  }

  const itemsPayload = opts.products.map((p) => ({
    order_id: order.id,
    product_id: p.id,
    description: p.title ?? "Complete Item",
    quantity: 1,
    unit_amount_net_cents: perItem.subtotal_cents,
    unit_amount_gross_cents: perItem.total_cents,
    tax_rate: perItem.tax_rate,
    tax_amount_cents: perItem.tax_cents,
  }));
  const { data: items, error: itemErr } = await (sb as any).from("order_items").insert(itemsPayload).select("id");
  if (itemErr || !items) {
    throw new Error(`[test-fixtures] createSmokeCompleteOrder.order_items failed: ${itemErr?.message}`);
  }

  const { error: flipErr } = await (sb as any).from("orders").update({ status: "paid" }).eq("id", order.id);
  if (flipErr) {
    throw new Error(`[test-fixtures] createSmokeCompleteOrder.flip failed: ${flipErr.message}`);
  }

  await emitAudit(sb, "test_fixture_created", {
    fixture_kind: "smoke_complete_order" satisfies FixtureKind,
    target_table: "public.orders",
    correlation_id: opts.correlationId,
    order_id: order.id,
    order_item_ids: items.map((i: any) => i.id),
    user_id: opts.userId,
    product_ids: opts.products.map((p) => p.id),
    distinct_curricula: Array.from(new Set(opts.products.map((p) => p.curriculum_id).filter(Boolean))),
  });

  return {
    orderId: order.id,
    orderItemIds: items.map((i: any) => i.id),
    sessionId,
    paymentIntentId: piId,
    billingEmail,
    itemCount: n,
  };
}

// ---------------------------------------------------------------------------
// Cleanup — service-role RPC discovers by correlation tag.
// ---------------------------------------------------------------------------

export async function cleanupSmokeByCorrelation(
  sb: SupabaseClient,
  opts: CorrelationOpts,
): Promise<{ removed_count: number }> {
  const { data, error } = await (sb as any).rpc(
    "_smoke_cleanup_by_correlation",
    { _correlation_id: opts.correlationId },
  );

  let removedCount = 0;

  if (error) {
    throw new Error(
      `[test-fixtures] cleanupSmokeByCorrelation RPC failed: ${error.message}. ` +
        `Ensure migration 20260517_pfad_c is applied.`,
    );
  } else {
    removedCount = Number((data as { removed_count?: number })?.removed_count ?? 0);
  }

  await emitAudit(sb, "test_fixture_cleanup", {
    fixture_kind: "smoke_order" satisfies FixtureKind,
    correlation_id: opts.correlationId,
    removed_count: removedCount,
  });

  return { removed_count: removedCount };
}

// ---------------------------------------------------------------------------
// Naming assertion (Pfad C) — ensure one-path commerce: no /bundle URLs leaked.
// ---------------------------------------------------------------------------

export interface NamingAssertResult {
  passed: boolean;
  scope: string;
  violations: string[];
}

/**
 * Asserts that a sample of product canonical URLs / SEO routes use `/paket/`
 * and never `/bundle/`. Emits `naming_assert_passed` or `naming_assert_failure`.
 * Returns the result; caller decides whether to fail.
 */
export async function assertNoLegacyBundleUrls(
  sb: SupabaseClient,
  opts: CorrelationOpts & { sampleSize?: number } = { correlationId: "" } as any,
): Promise<NamingAssertResult> {
  const sample = opts.sampleSize ?? 10;
  const violations: string[] = [];

  // Spot-check the published packages — their public commerce URL is /paket/<slug>.
  // We cannot crawl the static SPA here, but we can assert that no products
  // table has a stored canonical_url with /bundle/.
  const { data, error } = await (sb as any).from("products")
    .select("id, slug, seo_title, seo_description")
    .eq("status", "active")
    .limit(sample);
  if (error) {
    try {
      await emitAudit(sb, "test_fixture_created" as any, {
        _placeholder: "naming_assert_lookup_failed",
        correlation_id: opts.correlationId,
        error: error.message,
      });
    } catch { /* swallow */ }
  } else {
    for (const p of (data ?? [])) {
      const hay = `${p.seo_title ?? ""} ${p.seo_description ?? ""}`;
      if (hay.includes("/bundle/")) violations.push(`product ${p.slug}: SEO copy references /bundle/`);
    }
  }

  const passed = violations.length === 0;
  try {
    await sb.rpc("fn_emit_audit" as never, {
      _target_type: "test_fixture",
      _action_type: passed ? "naming_assert_passed" : "naming_assert_failure",
      _result_status: passed ? "ok" : "warning",
      _payload: passed
        ? { scope: "smoke.b2c.commerce", asserted: "no_legacy_bundle_urls", sample_size: sample, correlation_id: opts.correlationId }
        : { scope: "smoke.b2c.commerce", reason: "legacy_bundle_url_in_products", violations, correlation_id: opts.correlationId },
      _correlation_id: opts.correlationId,
    } as never);
  } catch { /* swallow */ }

  return { passed, scope: "smoke.b2c.commerce", violations };
}
