/**
 * b2c-ssot-smoke (Pfad C: complete + factories)
 * ---------------------------------------------
 * Synthetic Smoke für die SSOT-B2C-Pipeline. Schreibt ausschließlich über
 * `_shared/test-fixtures/` (Factories) — keine rohen Inserts mehr.
 *
 * Modi:
 *   - "single":   1 Produkt → 7 Artefakte + Replay-Idempotenz.
 *   - "complete": Mehrere Produkte in 1 Order (Komplettpaket-Shape-Test).
 *                 Verifiziert: order_items=N, invoices=1, grants=N, ents=1/curr.
 *   - "bundle":   DEPRECATED alias → leitet auf "complete" um + Audit
 *                 `deprecated_smoke_mode_called`.
 *   - "refund":   single-paid → fn_revoke_grant_on_refund → revoke + idempotenz.
 *   - "access_e2e": paid → 4 Feature-Gates + tutor + storage assertions.
 *
 * Naming-Assertion: assertNoLegacyBundleUrls() läuft in jedem Modus.
 *
 * Body: { mode?, user_id?, product_id?, product_ids?, cleanup?, correlation_id?, ... }
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { handleCorsPreflightRequest } from "../_shared/cors.ts";
import {
  newCorrelationId,
  createSmokeOrder,
  createSmokeCompleteOrder,
  cleanupSmokeByCorrelation,
  assertNoLegacyBundleUrls,
} from "../_shared/test-fixtures/index.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

type Mode = "single" | "complete" | "bundle" | "refund" | "access_e2e";

Deno.serve(async (req) => {
  const pre = handleCorsPreflightRequest(req);
  if (pre) return pre;

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!serviceKey) {
    return new Response(JSON.stringify({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY missing" }),
      { status: 500, headers: cors });
  }
  const sb = createClient(url, serviceKey);

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }

  const correlationId: string = body.correlation_id ?? newCorrelationId();
  const log = (...m: unknown[]) => console.log("[b2c-ssot-smoke]", ...m);
  let mode: Mode = body.mode ?? "single";

  // Naming-Assertion läuft immer (deprecation-mode-call wird zusätzlich auditiert)
  const naming = await assertNoLegacyBundleUrls(sb, { correlationId, sampleSize: 10 });

  // Deprecated alias: bundle → complete
  if (mode === "bundle") {
    await sb.rpc("fn_emit_audit" as never, {
      _target_type: "test_fixture",
      _action_type: "deprecated_smoke_mode_called",
      _result_status: "warning",
      _payload: { legacy_mode: "bundle", canonical_mode: "complete", correlation_id: correlationId },
      _correlation_id: correlationId,
    } as never).catch(() => {});
    log(`mode=bundle deprecated → routing to mode=complete (correlation=${correlationId})`);
    mode = "complete";
  }

  try {
    if (mode === "complete") return await runCompleteMode(sb, body, correlationId, naming, log);
    if (mode === "refund")   return await runRefundMode(sb, body, correlationId, naming, log);
    if (mode === "access_e2e") return await runAccessE2eMode(sb, body, correlationId, naming, log);
    return await runSingleMode(sb, body, correlationId, naming, log);
  } catch (e: any) {
    return new Response(JSON.stringify({
      ok: false, mode, correlation_id: correlationId, naming,
      error: e?.message ?? String(e),
    }, null, 2), { status: 500, headers: cors });
  }
});

// ============================================================================
// Helpers
// ============================================================================

async function resolveUserId(sb: SupabaseClient, body: any): Promise<string | null> {
  if (body.user_id) return body.user_id;
  const { data } = await (sb as any).from("profiles")
    .select("user_id").not("user_id", "is", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.user_id ?? null;
}

async function pickProduct(sb: SupabaseClient, productId?: string | null) {
  if (productId) {
    const { data } = await (sb as any).from("products")
      .select("id, title, curriculum_id").eq("id", productId).maybeSingle();
    return data;
  }
  const { data } = await (sb as any).from("products")
    .select("id, title, curriculum_id")
    .not("curriculum_id", "is", null).eq("status", "active")
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  return data;
}

async function pickProducts(sb: SupabaseClient, ids?: string[]): Promise<Array<{id:string;title:string|null;curriculum_id:string|null}>> {
  if (Array.isArray(ids) && ids.length > 0) {
    const { data } = await (sb as any).from("products")
      .select("id, title, curriculum_id").in("id", ids);
    return data ?? [];
  }
  const { data } = await (sb as any).from("products")
    .select("id, title, curriculum_id")
    .not("curriculum_id", "is", null).eq("status", "active")
    .order("updated_at", { ascending: false }).limit(20);
  const seen = new Set<string>(); const out: any[] = [];
  for (const p of (data ?? [])) {
    if (!p.curriculum_id || seen.has(p.curriculum_id)) continue;
    seen.add(p.curriculum_id); out.push(p);
    if (out.length >= 2) break;
  }
  return out;
}

async function countRows(sb: SupabaseClient, table: string, qb: (q: any) => any): Promise<number> {
  const { count } = await qb((sb as any).from(table).select("*", { count: "exact", head: true }));
  return count ?? 0;
}

// ============================================================================
// SINGLE
// ============================================================================
async function runSingleMode(sb: SupabaseClient, body: any, correlationId: string, naming: any, log: (...m:unknown[])=>void) {
  const failures: string[] = [];
  if (!naming.passed) failures.push(`naming_violations=${naming.violations.length}`);

  const userId = await resolveUserId(sb, body);
  if (!userId) return new Response(JSON.stringify({ ok: false, mode: "single", correlation_id: correlationId, error: "no user found" }), { status: 400, headers: cors });
  const product = await pickProduct(sb, body.product_id);
  if (!product?.id) return new Response(JSON.stringify({ ok: false, mode: "single", correlation_id: correlationId, error: "no product found" }), { status: 400, headers: cors });
  log("user", userId, "product", product.id, product.title);

  const created = await createSmokeOrder(sb, {
    correlationId, userId, productId: product.id, productTitle: product.title, kind: "single",
  });
  const orderId = created.orderId;
  log("order paid", orderId);

  const checks = {
    order_items: await countRows(sb, "order_items", (q: any) => q.eq("order_id", orderId)),
    invoices: await countRows(sb, "invoices", (q: any) => q.eq("order_id", orderId)),
    invoice_items: 0,
    payments: await countRows(sb, "payments", (q: any) => q.eq("order_id", orderId)),
    ledger_entries: await countRows(sb, "ledger_entries", (q: any) => q.eq("order_id", orderId)),
    learner_course_grants: await countRows(sb, "learner_course_grants",
      (q: any) => q.eq("order_id", orderId).eq("status", "active")),
    entitlements: 0,
  };
  const { data: invs } = await (sb as any).from("invoices").select("id").eq("order_id", orderId);
  if (invs?.length) {
    const { count } = await (sb as any).from("invoice_items").select("*", { count: "exact", head: true })
      .in("invoice_id", invs.map((r: any) => r.id));
    checks.invoice_items = count ?? 0;
  }
  if (product.curriculum_id) {
    const { data: ent } = await (sb as any).from("entitlements")
      .select("id").eq("user_id", userId).eq("curriculum_id", product.curriculum_id)
      .gt("valid_until", new Date().toISOString())
      .eq("has_learning_course", true).eq("has_exam_trainer", true)
      .eq("has_ai_tutor", true).eq("has_oral_trainer", true).maybeSingle();
    checks.entitlements = ent ? 1 : 0;
  }
  for (const [k, v] of Object.entries(checks)) if (v < 1) failures.push(`${k}=0`);

  const { data: replay, error: replayErr } = await (sb as any).rpc("admin_smoke_replay_order_fulfillment", { p_order_id: orderId });
  if (replayErr) failures.push(`replay rpc error: ${replayErr.message}`);
  const post = {
    invoices: await countRows(sb, "invoices", (q: any) => q.eq("order_id", orderId)),
    payments: await countRows(sb, "payments", (q: any) => q.eq("order_id", orderId)),
    ledger_entries: await countRows(sb, "ledger_entries", (q: any) => q.eq("order_id", orderId)),
  };
  const idempotency = {
    invoices_delta: post.invoices - checks.invoices,
    payments_delta: post.payments - checks.payments,
    ledger_delta: post.ledger_entries - checks.ledger_entries,
    replay_result: replay ?? null,
  };
  for (const [k, v] of Object.entries(idempotency))
    if (typeof v === "number" && v !== 0) failures.push(`idempotency drift ${k}=${v}`);

  if (body.cleanup === true) await cleanupSmokeByCorrelation(sb, { correlationId });

  return new Response(JSON.stringify({
    ok: failures.length === 0, mode: "single", correlation_id: correlationId,
    order_id: orderId, session_id: created.sessionId, naming, checks, idempotency, failures,
  }, null, 2), { status: failures.length === 0 ? 200 : 500, headers: cors });
}

// ============================================================================
// COMPLETE (formerly bundle)
// ============================================================================
async function runCompleteMode(sb: SupabaseClient, body: any, correlationId: string, naming: any, log: (...m:unknown[])=>void) {
  const failures: string[] = [];
  if (!naming.passed) failures.push(`naming_violations=${naming.violations.length}`);

  const userId = await resolveUserId(sb, body);
  if (!userId) return new Response(JSON.stringify({ ok: false, mode: "complete", correlation_id: correlationId, error: "no user found" }), { status: 400, headers: cors });
  const products = await pickProducts(sb, body.product_ids);
  if (products.length < 2) return new Response(JSON.stringify({
    ok: false, mode: "complete", correlation_id: correlationId,
    error: "need >=2 products with distinct curriculum_id", resolved: products,
  }), { status: 400, headers: cors });
  const distinctCurricula = new Set(products.map((p) => p.curriculum_id).filter(Boolean) as string[]);

  const created = await createSmokeCompleteOrder(sb, { correlationId, userId, products });
  const orderId = created.orderId;
  log("complete order paid", orderId, "items=", products.length);

  const checks: Record<string, number> = {
    order_items: await countRows(sb, "order_items", (q: any) => q.eq("order_id", orderId)),
    invoices: await countRows(sb, "invoices", (q: any) => q.eq("order_id", orderId)),
    invoice_items: 0,
    payments: await countRows(sb, "payments", (q: any) => q.eq("order_id", orderId)),
    ledger_entries: await countRows(sb, "ledger_entries", (q: any) => q.eq("order_id", orderId)),
    learner_course_grants: await countRows(sb, "learner_course_grants",
      (q: any) => q.eq("order_id", orderId).eq("status", "active")),
    entitlements: 0,
  };
  const { data: invs } = await (sb as any).from("invoices").select("id").eq("order_id", orderId);
  if (invs?.length) {
    const { count } = await (sb as any).from("invoice_items").select("*", { count: "exact", head: true })
      .in("invoice_id", invs.map((r: any) => r.id));
    checks.invoice_items = count ?? 0;
  }
  const { data: ents } = await (sb as any).from("entitlements")
    .select("curriculum_id, has_learning_course, has_exam_trainer, has_ai_tutor, has_oral_trainer, valid_until")
    .eq("user_id", userId).in("curriculum_id", Array.from(distinctCurricula))
    .gt("valid_until", new Date().toISOString());
  checks.entitlements = (ents ?? []).filter((e: any) =>
    e.has_learning_course && e.has_exam_trainer && e.has_ai_tutor && e.has_oral_trainer).length;

  const expected = {
    order_items: products.length, invoices: 1, payments: 1,
    learner_course_grants: products.length, entitlements: distinctCurricula.size,
  };
  for (const [k, v] of Object.entries(expected))
    if (checks[k] !== v) failures.push(`${k} expected=${v} got=${checks[k]}`);
  if (checks.invoice_items < products.length) failures.push(`invoice_items<${products.length} (got ${checks.invoice_items})`);
  if (checks.ledger_entries < 1) failures.push(`ledger_entries=0`);

  const { data: replay, error: replayErr } = await (sb as any).rpc("admin_smoke_replay_order_fulfillment", { p_order_id: orderId });
  if (replayErr) failures.push(`replay rpc error: ${replayErr.message}`);
  const post = {
    invoices: await countRows(sb, "invoices", (q: any) => q.eq("order_id", orderId)),
    payments: await countRows(sb, "payments", (q: any) => q.eq("order_id", orderId)),
    grants: await countRows(sb, "learner_course_grants", (q: any) =>
      q.eq("order_id", orderId).eq("status", "active")),
  };
  const idempotency = {
    invoices_delta: post.invoices - checks.invoices,
    payments_delta: post.payments - checks.payments,
    grants_delta: post.grants - checks.learner_course_grants,
    replay_result: replay ?? null,
  };
  for (const [k, v] of Object.entries(idempotency))
    if (typeof v === "number" && v !== 0) failures.push(`idempotency drift ${k}=${v}`);

  if (body.cleanup === true) await cleanupSmokeByCorrelation(sb, { correlationId });

  return new Response(JSON.stringify({
    ok: failures.length === 0, mode: "complete", correlation_id: correlationId,
    order_id: orderId, session_id: created.sessionId,
    products: products.map((p) => ({ id: p.id, title: p.title, curriculum_id: p.curriculum_id })),
    distinct_curricula: distinctCurricula.size,
    naming, checks, expected, idempotency, failures,
  }, null, 2), { status: failures.length === 0 ? 200 : 500, headers: cors });
}

// ============================================================================
// REFUND
// ============================================================================
async function runRefundMode(sb: SupabaseClient, body: any, correlationId: string, naming: any, log: (...m:unknown[])=>void) {
  const failures: string[] = [];
  if (!naming.passed) failures.push(`naming_violations=${naming.violations.length}`);

  const userId = await resolveUserId(sb, body);
  if (!userId) return new Response(JSON.stringify({ ok: false, mode: "refund", correlation_id: correlationId, error: "no user found" }), { status: 400, headers: cors });
  const product = await pickProduct(sb, body.product_id);
  if (!product?.id) return new Response(JSON.stringify({ ok: false, mode: "refund", correlation_id: correlationId, error: "no product" }), { status: 400, headers: cors });

  const created = await createSmokeOrder(sb, {
    correlationId, userId, productId: product.id, productTitle: product.title, kind: "refund",
  });
  const orderId = created.orderId;
  log("refund: order paid", orderId);

  const grantsBefore = await countRows(sb, "learner_course_grants",
    (q: any) => q.eq("order_id", orderId).eq("status", "active"));
  if (grantsBefore < 1) failures.push(`pre-refund: no active grants (got ${grantsBefore})`);

  const refundId = `re_test_${correlationId.slice(0, 12)}`;
  const { data: refundRes, error: refundErr } = await (sb as any).rpc("fn_revoke_grant_on_refund", {
    p_stripe_payment_intent_id: created.paymentIntentId, p_refund_id: refundId, p_reason: "smoke_test",
  });
  if (refundErr) failures.push(`refund rpc error: ${refundErr.message}`);

  const grantsActive = await countRows(sb, "learner_course_grants",
    (q: any) => q.eq("order_id", orderId).eq("status", "active"));
  const grantsRefunded = await countRows(sb, "learner_course_grants",
    (q: any) => q.eq("order_id", orderId).eq("status", "refunded"));
  const { data: entsAfter } = await (sb as any).from("entitlements")
    .select("id, valid_until").eq("source_ref", orderId);
  const entsRevoked = (entsAfter ?? []).filter((e: any) =>
    e.valid_until && new Date(e.valid_until) <= new Date()).length;
  const { data: audit } = await (sb as any).from("admin_actions")
    .select("id").eq("action", "gdpr_or_refund.grant_revoked_on_refund")
    .contains("payload", { refund_id: refundId } as any).limit(1);

  if (grantsActive !== 0) failures.push(`grants still active=${grantsActive}`);
  if (grantsRefunded < 1) failures.push(`grants refunded=${grantsRefunded}`);
  if (entsRevoked < 1) failures.push(`entitlements revoked=${entsRevoked}`);
  if (!audit || audit.length === 0) failures.push("audit row missing");

  const { data: refund2 } = await (sb as any).rpc("fn_revoke_grant_on_refund", {
    p_stripe_payment_intent_id: created.paymentIntentId, p_refund_id: refundId, p_reason: "smoke_test",
  });
  if ((refund2 as any)?.revoked_grants > 0) failures.push(`refund 2nd run revoked ${(refund2 as any).revoked_grants}`);

  if (body.cleanup === true) await cleanupSmokeByCorrelation(sb, { correlationId });

  return new Response(JSON.stringify({
    ok: failures.length === 0, mode: "refund", correlation_id: correlationId,
    order_id: orderId, refund_id: refundId, naming,
    refund_result: refundRes ?? null, refund_idempotency: refund2 ?? null,
    pre: { grants_active: grantsBefore },
    post: { grants_active: grantsActive, grants_refunded: grantsRefunded, entitlements_revoked: entsRevoked, audit_rows: audit?.length ?? 0 },
    failures,
  }, null, 2), { status: failures.length === 0 ? 200 : 500, headers: cors });
}

// ============================================================================
// ACCESS E2E
// ============================================================================
async function runAccessE2eMode(sb: SupabaseClient, body: any, correlationId: string, naming: any, log: (...m:unknown[])=>void) {
  const failures: string[] = [];
  if (!naming.passed) failures.push(`naming_violations=${naming.violations.length}`);

  const userId = await resolveUserId(sb, body);
  if (!userId) return new Response(JSON.stringify({ ok: false, mode: "access_e2e", correlation_id: correlationId, error: "no user" }), { status: 400, headers: cors });
  const product = await pickProduct(sb, body.product_id);
  if (!product?.id || !product.curriculum_id) return new Response(JSON.stringify({
    ok: false, mode: "access_e2e", correlation_id: correlationId, error: "no product+curriculum",
  }), { status: 400, headers: cors });
  const curriculumId = product.curriculum_id;

  const created = await createSmokeOrder(sb, {
    correlationId, userId, productId: product.id, productTitle: product.title, kind: "access",
  });
  const orderId = created.orderId;
  log("access_e2e: order paid", orderId);
  await new Promise((r) => setTimeout(r, 500));

  async function assertFeatureAccess(label: string): Promise<Record<string, any>> {
    const features = ["learning_course", "exam_trainer", "ai_tutor", "oral_trainer"] as const;
    const out: Record<string, any> = {};
    for (const feat of features) {
      const { data, error } = await (sb as any).rpc("check_product_access_by_curriculum", {
        p_user_id: userId, p_curriculum_id: curriculumId, p_feature: feat,
      });
      if (error) failures.push(`[${label}] check(${feat}) error: ${error.message}`);
      out[feat] = data;
      if (data !== true) failures.push(`[${label}] ${feat} allowed=${data}`);
    }
    const { data: tutor } = await (sb as any).rpc("tutor_access_check",
      { p_user_id: userId, p_curriculum_id: curriculumId, p_daily_limit: 200 });
    out.tutor = tutor;
    if (!tutor || tutor.allowed !== true) failures.push(`[${label}] tutor allowed=${tutor?.allowed} reason=${tutor?.reason}`);
    if (tutor?.reason === "no_entitlement") failures.push(`[${label}] tutor reason=no_entitlement`);
    const { data: storage } = await (sb as any).rpc("has_storage_entitlement",
      { p_user_id: userId, p_curriculum_id: curriculumId });
    out.storage = storage;
    if (storage !== true) failures.push(`[${label}] storage=${storage}`);
    const { data: prodAccess } = await (sb as any).rpc("can_access_product",
      { p_user_id: userId, p_product_id: product.id });
    out.product = prodAccess;
    if (prodAccess !== true) failures.push(`[${label}] product=${prodAccess}`);
    return out;
  }

  const baseline = await assertFeatureAccess("with_entitlement");

  let grantOnly: Record<string, any> | null = null;
  if (body.drop_entitlement === true) {
    await (sb as any).from("entitlements").delete()
      .eq("user_id", userId).eq("curriculum_id", curriculumId).eq("source_ref", orderId);
    await new Promise((r) => setTimeout(r, 200));
    grantOnly = await assertFeatureAccess("grant_only");
  }

  let driftDenied: Record<string, any> | null = null;
  if (body.assert_drift_denies === true) {
    await (sb as any).from("entitlements").delete()
      .eq("user_id", userId).eq("curriculum_id", curriculumId).eq("source_ref", orderId);
    await (sb as any).from("learner_course_grants").delete()
      .eq("user_id", userId).eq("order_id", orderId);
    await new Promise((r) => setTimeout(r, 200));

    const features = ["learning_course", "exam_trainer", "ai_tutor", "oral_trainer"] as const;
    const denyOut: Record<string, any> = {};
    for (const feat of features) {
      const { data } = await (sb as any).rpc("check_product_access_by_curriculum",
        { p_user_id: userId, p_curriculum_id: curriculumId, p_feature: feat });
      denyOut[feat] = data;
      if (data !== false) failures.push(`[drift_deny] ${feat} expected=false got=${data}`);
    }
    const { data: tutor } = await (sb as any).rpc("tutor_access_check",
      { p_user_id: userId, p_curriculum_id: curriculumId, p_daily_limit: 200 });
    denyOut.tutor = tutor;
    if (tutor?.allowed === true) failures.push(`[drift_deny] tutor still allowed`);
    const { data: storage } = await (sb as any).rpc("has_storage_entitlement",
      { p_user_id: userId, p_curriculum_id: curriculumId });
    denyOut.storage = storage;
    if (storage !== false) failures.push(`[drift_deny] storage=${storage}`);
    const { data: prodAccess } = await (sb as any).rpc("can_access_product",
      { p_user_id: userId, p_product_id: product.id });
    denyOut.product = prodAccess;
    if (prodAccess !== false) failures.push(`[drift_deny] product=${prodAccess}`);
    driftDenied = denyOut;
  }

  if (body.cleanup === true) await cleanupSmokeByCorrelation(sb, { correlationId });

  return new Response(JSON.stringify({
    ok: failures.length === 0, mode: "access_e2e", correlation_id: correlationId,
    order_id: orderId, user_id: userId, product_id: product.id, curriculum_id: curriculumId,
    naming, baseline, grant_only: grantOnly, drift_denied: driftDenied, failures,
  }, null, 2), { status: failures.length === 0 ? 200 : 500, headers: cors });
}
