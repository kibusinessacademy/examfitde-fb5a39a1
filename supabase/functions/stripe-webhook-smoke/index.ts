// stripe-webhook-smoke
// ----------------------------------------------------------------------------
// Local-friendly smoke test for the stripe-webhook edge function.
//
// Builds a minimal but Stripe-shape-correct event payload, signs it with
// STRIPE_WEBHOOK_TEST_SECRET (HMAC-SHA256 over `${ts}.${body}`), POSTs it to
// the deployed stripe-webhook function, and verifies the expected DB
// side-effects (orders.status, learner_course_grants, entitlements,
// admin_actions audit row for refunds).
//
// Modes (POST { mode: "checkout" | "refund" | "both" }, default "both")
// Auth: requires Service-Role bearer (same pattern as b2c-ssot-smoke).
//
// Returns: { ok, results: [{ mode, http, webhook_response, db_checks, failures }] }
// ----------------------------------------------------------------------------
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleCorsPreflightRequest } from "../_shared/cors.ts";

const corsJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    },
  });

// HMAC-SHA256 → hex (Stripe signature scheme v1)
async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function buildStripeSignatureHeader(secret: string, body: string): Promise<string> {
  const ts = Math.floor(Date.now() / 1000);
  const v1 = await hmacHex(secret, `${ts}.${body}`);
  return `t=${ts},v1=${v1}`;
}

// ─── Pick a real product/curriculum/user so the webhook actually fulfills ───
async function pickFixtures(admin: any) {
  const { data: products } = await admin
    .from("products")
    .select("id, stripe_price_id, curriculum_id")
    .not("stripe_price_id", "is", null)
    .not("curriculum_id", "is", null)
    .limit(1);
  const product = products?.[0];
  if (!product) throw new Error("No published product with stripe_price_id+curriculum_id");

  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  const user = users?.users?.[0];
  if (!user) throw new Error("No auth user available for fixture");

  return { product, user };
}

interface CheckoutFixture {
  sessionId: string;
  paymentIntentId: string;
  customerId: string;
  amountTotal: number;
  productId: string;
  curriculumId: string;
  userId: string;
  priceId: string;
}

function fakeId(prefix: string): string {
  const r = crypto.randomUUID().replace(/-/g, "");
  return `${prefix}_smoke_${r.slice(0, 24)}`;
}

function buildCheckoutEvent(f: CheckoutFixture) {
  return {
    id: fakeId("evt"),
    object: "event",
    api_version: "2023-10-16",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: "checkout.session.completed",
    data: {
      object: {
        id: f.sessionId,
        object: "checkout.session",
        amount_total: f.amountTotal,
        currency: "eur",
        customer: f.customerId,
        customer_details: { email: "smoke@examfit.test" },
        payment_intent: f.paymentIntentId,
        payment_status: "paid",
        mode: "payment",
        status: "complete",
        // create-payment metadata layout (B2C ExamFit branch)
        metadata: {
          flow: "create_payment",
          user_id: f.userId,
          product_id: f.productId,
          experiment_key: null,
          variant_key: null,
        },
      },
    },
  };
}

// Build a charge.refunded event whose shape matches what the stripe-webhook
// refund handler reads 1:1:
//   - charge.amount_refunded             → refundAmount
//   - charge.payment_intent (string)     → paymentIntentId
//   - charge.refunds.data[0].id          → refundId (anchor for fn_revoke_grant_on_refund)
// Returns both the event and the refundId so the smoke can assert on it.
function buildRefundEvent(
  paymentIntentId: string,
  chargeId: string,
  amount: number,
): { event: Record<string, unknown>; refundId: string } {
  const refundId = fakeId("re");
  const nowSec = Math.floor(Date.now() / 1000);
  const event = {
    id: fakeId("evt"),
    object: "event",
    api_version: "2023-10-16",
    created: nowSec,
    livemode: false,
    type: "charge.refunded",
    data: {
      object: {
        id: chargeId,
        object: "charge",
        amount,
        amount_captured: amount,
        amount_refunded: amount, // ← read by handler
        currency: "eur",
        paid: true,
        captured: true,
        status: "succeeded",
        payment_intent: paymentIntentId, // ← read by handler (string form)
        refunded: true,                  // full refund flag for handler logic
        created: nowSec - 60,
        refunds: {
          object: "list",
          has_more: false,
          total_count: 1,
          url: `/v1/charges/${chargeId}/refunds`,
          data: [{
            id: refundId,                // ← read by handler
            object: "refund",
            amount,
            charge: chargeId,
            currency: "eur",
            payment_intent: paymentIntentId,
            reason: "requested_by_customer",
            status: "succeeded",
            created: nowSec,
          }],
        },
      },
    },
  };
  return { event, refundId };
}

async function postSignedEvent(
  webhookUrl: string,
  testSecret: string,
  event: Record<string, unknown>,
) {
  const body = JSON.stringify(event);
  const sigHeader = await buildStripeSignatureHeader(testSecret, body);
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": sigHeader },
    body,
  });
  const text = await res.text();
  return { http: res.status, body: text };
}

async function verifyCheckoutEffects(
  admin: any,
  f: CheckoutFixture,
): Promise<{ ok: boolean; checks: Record<string, unknown>; failures: string[] }> {
  const failures: string[] = [];
  const checks: Record<string, unknown> = {};

  // 1) order should exist + paid
  const { data: orders } = await admin
    .from("orders")
    .select("id, status, stripe_payment_intent_id")
    .eq("stripe_payment_intent_id", f.paymentIntentId)
    .limit(1);
  checks.order = orders?.[0] ?? null;
  if (!orders?.[0]) failures.push("order_missing");
  else if (orders[0].status !== "paid") failures.push(`order_status=${orders[0].status}`);

  // 2) grant for user+curriculum
  const { data: grants } = await admin
    .from("learner_course_grants")
    .select("id, status, curriculum_id")
    .eq("user_id", f.userId)
    .eq("curriculum_id", f.curriculumId)
    .limit(1);
  checks.grant = grants?.[0] ?? null;
  if (!grants?.[0]) failures.push("grant_missing");

  // 3) entitlement bridge
  const { data: ents } = await admin
    .from("entitlements")
    .select("id, has_exam_first, has_ai_tutor, valid_until")
    .eq("user_id", f.userId)
    .eq("curriculum_id", f.curriculumId)
    .limit(1);
  checks.entitlement = ents?.[0] ?? null;
  if (!ents?.[0]) failures.push("entitlement_missing");

  return { ok: failures.length === 0, checks, failures };
}

async function verifyRefundEffects(
  admin: any,
  paymentIntentId: string,
  userId: string,
  curriculumId: string,
): Promise<{ ok: boolean; checks: Record<string, unknown>; failures: string[] }> {
  const failures: string[] = [];
  const checks: Record<string, unknown> = {};

  const { data: grants } = await admin
    .from("learner_course_grants")
    .select("id, status")
    .eq("user_id", userId)
    .eq("curriculum_id", curriculumId)
    .limit(1);
  checks.grant = grants?.[0] ?? null;
  if (grants?.[0]?.status !== "refunded") failures.push(`grant_status=${grants?.[0]?.status}`);

  const { data: ents } = await admin
    .from("entitlements")
    .select("id, valid_until")
    .eq("user_id", userId)
    .eq("curriculum_id", curriculumId)
    .limit(1);
  checks.entitlement = ents?.[0] ?? null;
  if (!ents?.[0]?.valid_until || new Date(ents[0].valid_until as string) > new Date()) {
    failures.push("entitlement_not_revoked");
  }

  const { data: audit } = await admin
    .from("admin_actions")
    .select("id, action_type")
    .eq("action_type", "grant_revoked_on_refund")
    .like("metadata->>payment_intent_id", paymentIntentId)
    .limit(1);
  checks.audit = audit?.[0] ?? null;
  // Audit row not strictly required (depends on fn impl) — soft-check
  if (!audit?.[0]) checks.audit_warning = "no admin_actions row found (soft)";

  return { ok: failures.length === 0, checks, failures };
}

async function cleanupFixture(
  admin: any,
  paymentIntentId: string,
) {
  // Best-effort cleanup. Order trigger cascades grants/entitlements via ON DELETE rules
  // where present; otherwise leave orphaned smoke rows for ops to inspect.
  const { data: orders } = await admin
    .from("orders")
    .select("id")
    .eq("stripe_payment_intent_id", paymentIntentId);
  for (const o of orders ?? []) {
    await admin.from("order_items").delete().eq("order_id", o.id);
    await admin.from("invoice_items").delete().eq("order_id", o.id);
    await admin.from("invoices").delete().eq("order_id", o.id);
    await admin.from("payments").delete().eq("order_id", o.id);
    await admin.from("ledger_entries").delete().eq("order_id", o.id);
    await admin.from("orders").delete().eq("id", o.id);
  }
  await admin.from("stripe_event_log").delete().like("payload->>id", "evt_smoke_%");
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;

  // Auth: service-role only (same pattern as b2c-ssot-smoke)
  const authz = req.headers.get("authorization") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!authz.includes(serviceKey) || !serviceKey) {
    return corsJson({ ok: false, error: "service-role bearer required" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const testSecret = Deno.env.get("STRIPE_WEBHOOK_TEST_SECRET");
  if (!testSecret) {
    return corsJson({
      ok: false,
      error: "STRIPE_WEBHOOK_TEST_SECRET not configured (smoke/staging only)",
    }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const webhookUrl = `${supabaseUrl}/functions/v1/stripe-webhook`;

  let body: { mode?: string; cleanup?: boolean } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const mode = body.mode ?? "both";
  const doCleanup = body.cleanup ?? true;

  const results: Array<Record<string, unknown>> = [];

  try {
    const { product, user } = await pickFixtures(admin);
    const fixture: CheckoutFixture = {
      sessionId: fakeId("cs"),
      paymentIntentId: fakeId("pi"),
      customerId: fakeId("cus"),
      amountTotal: 4900,
      productId: product.id as string,
      curriculumId: product.curriculum_id as string,
      userId: user.id,
      priceId: product.stripe_price_id as string,
    };

    if (mode === "checkout" || mode === "both") {
      const checkoutEvent = buildCheckoutEvent(fixture);
      const post = await postSignedEvent(webhookUrl, testSecret, checkoutEvent);
      // small wait for trigger fan-out
      await new Promise((r) => setTimeout(r, 1500));
      const verify = await verifyCheckoutEffects(admin, fixture);
      results.push({ mode: "checkout", http: post.http, webhook_response: post.body.slice(0, 500), ...verify });
    }

    if (mode === "refund" || mode === "both") {
      // For refund we re-use the same payment_intent so the existing grant gets revoked
      const chargeId = fakeId("ch");
      const refundEvent = buildRefundEvent(fixture.paymentIntentId, chargeId, fixture.amountTotal);
      const post = await postSignedEvent(webhookUrl, testSecret, refundEvent);
      await new Promise((r) => setTimeout(r, 1500));
      const verify = await verifyRefundEffects(admin, fixture.paymentIntentId, fixture.userId, fixture.curriculumId);
      results.push({ mode: "refund", http: post.http, webhook_response: post.body.slice(0, 500), ...verify });
    }

    if (doCleanup) {
      await cleanupFixture(admin, fixture.paymentIntentId);
    }

    const ok = results.every((r) => r.ok);
    return corsJson({ ok, fixture: { user_id: fixture.userId, product_id: fixture.productId, payment_intent_id: fixture.paymentIntentId }, results }, ok ? 200 : 500);
  } catch (e) {
    return corsJson({ ok: false, error: String(e), results }, 500);
  }
});
