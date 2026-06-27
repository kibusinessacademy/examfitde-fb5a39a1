// COURSE.PROFIT.OS.1 — Admin-only profitability evaluator.
// Loads sellable products + sales aggregates, runs Pure SSOT projector,
// persists append-only snapshots (idempotent per inputs_hash).
import { requireAdmin, handleCors, json } from "../_shared/adminGuard.ts";
import { project, type EvalInput } from "../_shared/courseProfitability/index.ts";

const DEFAULT_WINDOW_DAYS = 90;

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const ctx = await requireAdmin(req);
  if (ctx instanceof Response) return ctx;
  const sb = ctx.sb;

  let body: { product_id?: string; window_days?: number; limit?: number } = {};
  try { body = await req.json(); } catch { /* ok */ }
  const windowDays = Math.min(365, Math.max(7, body.window_days ?? DEFAULT_WINDOW_DAYS));
  const limit = Math.min(500, Math.max(1, body.limit ?? 250));

  // 1) Load sellable products from SSOT view
  let q = sb.from("v_public_sellable_courses")
    .select("product_id, product_title, product_slug, modules, lessons, lessons_ready, published_at, is_sellable");
  if (body.product_id) q = q.eq("product_id", body.product_id);
  const { data: products, error: pErr } = await q.limit(limit);
  if (pErr) return json({ error: "products_query_failed", detail: pErr.message }, 500);

  if (!products || products.length === 0) {
    return json({ ok: true, evaluated: 0, results: [] });
  }

  const productIds = products.map((p: any) => p.product_id).filter(Boolean);
  const sinceIso = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  // 2) Aggregate orders via order_items in window for paid orders
  const { data: items, error: iErr } = await sb
    .from("order_items")
    .select("product_id, quantity, unit_amount_gross_cents, order_id, orders!inner(status, created_at, stripe_fee_cents)")
    .in("product_id", productIds)
    .gte("orders.created_at", sinceIso);
  if (iErr) return json({ error: "items_query_failed", detail: iErr.message }, 500);

  type Agg = { units: number; gross: number; fees: number; refunds: number };
  const sales = new Map<string, Agg>();
  for (const it of (items ?? []) as any[]) {
    const ord = it.orders;
    if (!ord) continue;
    const paid = ord.status === "paid" || ord.status === "fulfilled" || ord.status === "completed";
    const refunded = ord.status === "refunded";
    if (!paid && !refunded) continue;
    const a = sales.get(it.product_id) ?? { units: 0, gross: 0, fees: 0, refunds: 0 };
    const qty = it.quantity ?? 1;
    const line = (it.unit_amount_gross_cents ?? 0) * qty;
    if (paid) {
      a.units += qty;
      a.gross += line;
      a.fees += ord.stripe_fee_cents ?? 0;
    } else {
      a.refunds += line;
    }
    sales.set(it.product_id, a);
  }

  // 3) Project + persist
  const results: any[] = [];
  let inserted = 0;
  let skipped = 0;

  for (const p of products as any[]) {
    if (!p.product_id) continue;
    const s = sales.get(p.product_id) ?? { units: 0, gross: 0, fees: 0, refunds: 0 };
    const input: EvalInput = {
      product: {
        product_id: p.product_id,
        product_title: p.product_title,
        product_slug: p.product_slug,
        modules: p.modules ?? 0,
        lessons: p.lessons ?? 0,
        is_sellable: !!p.is_sellable,
        published_at: p.published_at,
      },
      sales: {
        units_sold: s.units,
        gross_revenue_cents: s.gross,
        refunds_cents: s.refunds,
        stripe_fees_cents_known: s.fees > 0 ? s.fees : undefined,
      },
      window_days: windowDays,
    };
    const snap = project(input);

    const { error: insErr } = await sb
      .from("course_profitability_snapshots")
      .insert({
        product_id: snap.product_id,
        product_title: snap.product_title,
        product_slug: snap.product_slug,
        window_days: snap.window_days,
        units_sold: snap.units_sold,
        gross_revenue_cents: snap.gross_revenue_cents,
        stripe_fees_cents: snap.stripe_fees_cents,
        refunds_cents: snap.refunds_cents,
        net_revenue_cents: snap.net_revenue_cents,
        ai_cost_cents: snap.ai_cost_cents,
        build_cost_cents: snap.build_cost_cents,
        overhead_cents: snap.overhead_cents,
        total_cost_cents: snap.total_cost_cents,
        margin_cents: snap.margin_cents,
        margin_ratio: snap.margin_ratio,
        payback_units: snap.payback_units,
        class: snap.class,
        recommendation_code: snap.recommendation_code,
        recommendation_reason: snap.recommendation_reason,
        confidence: snap.confidence,
        inputs_hash: snap.inputs_hash,
        evaluator_version: snap.evaluator_version,
        cost_breakdown: snap.cost_breakdown,
        revenue_breakdown: snap.revenue_breakdown,
      });
    if (insErr) {
      if (insErr.code === "23505") { skipped++; } // unique inputs_hash → already evaluated
      else { results.push({ product_id: snap.product_id, error: insErr.message }); continue; }
    } else {
      inserted++;
    }
    results.push({
      product_id: snap.product_id,
      class: snap.class,
      margin_cents: snap.margin_cents,
      recommendation: snap.recommendation_code,
    });
  }

  return json({
    ok: true,
    window_days: windowDays,
    evaluated: products.length,
    inserted,
    skipped_idempotent: skipped,
    results,
  });
});
