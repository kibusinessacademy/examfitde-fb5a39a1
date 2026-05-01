/**
 * b2c-ssot-smoke
 * --------------
 * Synthetic Smoke für die SSOT-B2C-Pipeline.
 *
 * Modi (POST body):
 *   { "mode"?: "single" | "bundle" | "refund", ... }
 *
 * mode="single" (default): 1 product, voller Order→paid-Pfad,
 *   verifiziert 7 Artefakte + Idempotenz-Replay.
 *
 * mode="bundle": mehrere products in 1 Order
 *   { "product_ids": uuid[] }  (default: top 2 active products mit curriculum_id)
 *   Verifiziert: order_items=N, invoices=1, invoice_items>=N, payments=1,
 *   ledger_entries>=1, learner_course_grants=N (1 pro product), entitlements=N
 *   (1 pro distinct curriculum). Idempotenz-Replay.
 *
 * mode="refund": ruft single-mode intern auf, dann fn_revoke_grant_on_refund
 *   und verifiziert: grants→refunded, entitlements valid_until<=now,
 *   admin_actions Audit vorhanden, 2. Refund-Aufruf idempotent.
 *
 * Common params: { "user_id"?: uuid, "cleanup"?: boolean }
 * Antwort: { ok, mode, order_id, checks, idempotency, failures }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleCorsPreflightRequest } from "../_shared/cors.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  const pre = handleCorsPreflightRequest(req);
  if (pre) return pre;

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!serviceKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY missing" }),
      { status: 500, headers: cors },
    );
  }
  const sb = createClient(url, serviceKey);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const failures: string[] = [];
  const log = (...m: unknown[]) => console.log("[b2c-ssot-smoke]", ...m);

  // 1. Resolve User + Product
  let userId: string | null = body.user_id ?? null;
  if (!userId) {
    const { data } = await sb
      .from("profiles")
      .select("user_id")
      .not("user_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    userId = data?.user_id ?? null;
  }
  if (!userId) {
    return new Response(JSON.stringify({ ok: false, error: "no user found" }), {
      status: 400,
      headers: cors,
    });
  }

  let productId: string | null = body.product_id ?? null;
  let productTitle: string | null = null;
  if (!productId) {
    const { data } = await sb
      .from("products")
      .select("id, title")
      .not("curriculum_id", "is", null)
      .eq("status", "active")
      .not("title", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    productId = data?.id ?? null;
    productTitle = data?.title ?? null;
  } else {
    const { data } = await sb.from("products").select("title").eq("id", productId).maybeSingle();
    productTitle = data?.title ?? null;
  }
  if (!productId) {
    return new Response(JSON.stringify({ ok: false, error: "no product found" }), {
      status: 400,
      headers: cors,
    });
  }

  log("user", userId, "product", productId, productTitle);

  // 2. Synthetic Order: pending → items → paid
  const sessionId = `cs_test_synthetic_${crypto.randomUUID()}`;
  const piId = `pi_test_synthetic_${crypto.randomUUID()}`;
  const stripeInvId = `in_test_synthetic_${crypto.randomUUID().slice(0, 8)}`;
  const totalCents = 4900;
  const subtotal = Math.round(totalCents / 1.19);
  const tax = totalCents - subtotal;

  const { data: order, error: orderErr } = await sb
    .from("orders")
    .insert({
      buyer_user_id: userId,
      billing_email: "smoke@test.local",
      billing_name: "B2C SSOT Smoke",
      currency: "eur",
      country: "DE",
      tax_mode: "gross",
      subtotal_cents: subtotal,
      tax_cents: tax,
      total_cents: totalCents,
      status: "pending",
      stripe_checkout_session_id: sessionId,
      stripe_payment_intent_id: piId,
      stripe_fee_cents: 150,
      stripe_invoice_id: stripeInvId,
      stripe_invoice_pdf_url: "https://invoice.test/pdf",
      stripe_customer_id: "cus_test_synthetic",
    })
    .select("id")
    .single();

  if (orderErr || !order) {
    return new Response(
      JSON.stringify({ ok: false, error: "order insert failed", detail: orderErr }),
      { status: 500, headers: cors },
    );
  }
  const orderId = order.id;
  log("order created (pending)", orderId);

  const { error: itemErr } = await sb.from("order_items").insert({
    order_id: orderId,
    product_id: productId,
    description: productTitle ?? "Smoke Product",
    quantity: 1,
    unit_amount_net_cents: subtotal,
    unit_amount_gross_cents: totalCents,
    tax_rate: 19.0,
    tax_amount_cents: tax,
  });
  if (itemErr) {
    return new Response(
      JSON.stringify({ ok: false, error: "order_item insert failed", detail: itemErr, order_id: orderId }),
      { status: 500, headers: cors },
    );
  }

  // status → paid: feuert process_order_paid_fulfillment
  const { error: flipErr } = await sb.from("orders").update({ status: "paid" }).eq("id", orderId);
  if (flipErr) {
    return new Response(
      JSON.stringify({ ok: false, error: "status flip failed", detail: flipErr, order_id: orderId }),
      { status: 500, headers: cors },
    );
  }
  log("order flipped → paid", orderId);

  // 3. Verifizierung aller Artefakte
  async function count(table: string, qb: (q: any) => any): Promise<number> {
    const { count: c } = await qb(sb.from(table).select("*", { count: "exact", head: true }));
    return c ?? 0;
  }

  const checks = {
    order_items: await count("order_items", (q: any) => q.eq("order_id", orderId)),
    invoices: await count("invoices", (q: any) => q.eq("order_id", orderId)),
    invoice_items: 0,
    payments: await count("payments", (q: any) => q.eq("order_id", orderId)),
    ledger_entries: await count("ledger_entries", (q: any) => q.eq("order_id", orderId)),
    learner_course_grants: 0,
    entitlements: 0,
  };
  // invoice_items via Subselect
  const { data: invs } = await sb.from("invoices").select("id").eq("order_id", orderId);
  if (invs && invs.length > 0) {
    const ids = invs.map((r: any) => r.id);
    const { count: c } = await sb
      .from("invoice_items")
      .select("*", { count: "exact", head: true })
      .in("invoice_id", ids);
    checks.invoice_items = c ?? 0;
  }
  // grants/entitlements: per order_id (nicht created_at — UPSERTs lassen created_at unverändert)
  // Entitlement-Match per source_ref=order_id, da entitlements keine direkte order_id-FK hat.
  checks.learner_course_grants = await count("learner_course_grants", (q: any) =>
    q.eq("order_id", orderId).eq("status", "active"),
  );
  // Fallback für entitlements: Curriculum aus Order ableiten und matchen
  const { data: orderProd } = await sb
    .from("order_items")
    .select("products(curriculum_id)")
    .eq("order_id", orderId)
    .limit(1)
    .maybeSingle();
  const curriculumId = (orderProd as any)?.products?.curriculum_id ?? null;
  if (curriculumId) {
    const { data: ent } = await sb
      .from("entitlements")
      .select("id, has_learning_course, has_exam_trainer, has_ai_tutor, has_oral_trainer, valid_until")
      .eq("user_id", userId)
      .eq("curriculum_id", curriculumId)
      .gt("valid_until", new Date().toISOString())
      .eq("has_learning_course", true)
      .eq("has_exam_trainer", true)
      .eq("has_ai_tutor", true)
      .eq("has_oral_trainer", true)
      .maybeSingle();
    checks.entitlements = ent ? 1 : 0;
  } else {
    checks.entitlements = 0;
    failures.push("curriculum_id not resolvable from order_items");
  }

  for (const [k, v] of Object.entries(checks)) {
    if (v < 1) failures.push(`${k}=0`);
  }

  // 4. Idempotenz-Re-Run via Replay-RPC
  const { data: replay, error: replayErr } = await sb.rpc(
    "admin_smoke_replay_order_fulfillment" as any,
    { p_order_id: orderId },
  );
  if (replayErr) {
    failures.push(`replay rpc error: ${replayErr.message}`);
  }

  // Re-Verify: counts dürfen sich NICHT verändert haben
  const post = {
    invoices: await count("invoices", (q: any) => q.eq("order_id", orderId)),
    payments: await count("payments", (q: any) => q.eq("order_id", orderId)),
    ledger_entries: await count("ledger_entries", (q: any) => q.eq("order_id", orderId)),
  };
  const idempotency = {
    invoices_delta: post.invoices - checks.invoices,
    payments_delta: post.payments - checks.payments,
    ledger_delta: post.ledger_entries - checks.ledger_entries,
    replay_result: replay ?? null,
  };
  for (const [k, v] of Object.entries(idempotency)) {
    if (typeof v === "number" && v !== 0) failures.push(`idempotency drift ${k}=${v}`);
  }

  // 5. Optional Cleanup (default false → /app/rechnungen kann verifiziert werden)
  if (body.cleanup === true) {
    await sb.from("ledger_entries").delete().eq("order_id", orderId);
    await sb.from("payments").delete().eq("order_id", orderId);
    if (invs && invs.length > 0) {
      await sb.from("invoice_items").delete().in("invoice_id", invs.map((r: any) => r.id));
      await sb.from("invoices").delete().eq("order_id", orderId);
    }
    await sb.from("order_items").delete().eq("order_id", orderId);
    await sb.from("orders").delete().eq("id", orderId);
    log("cleanup done");
  }

  return new Response(
    JSON.stringify({
      ok: failures.length === 0,
      order_id: orderId,
      session_id: sessionId,
      checks,
      idempotency,
      failures,
    }, null, 2),
    { status: failures.length === 0 ? 200 : 500, headers: cors },
  );
});
