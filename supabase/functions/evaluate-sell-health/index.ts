// SELL.HEALTH.OS.1 — Admin-only Selling Operator projector (read-only).
import { requireAdmin, handleCors, json } from "../_shared/adminGuard.ts";
import {
  project,
  type CtaPerformanceRow,
  type ExperimentResultRow,
  type FunnelIntegrityRow,
  type FunnelOverviewRow,
  type PaidOrderRow,
  type RevenueHealthRow,
  type SellabilityRow,
  type VariantDriftRow,
} from "../_shared/sellHealth/index.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const ctx = await requireAdmin(req);
  if (ctx instanceof Response) return ctx;
  const sb = ctx.sb;

  const since30d = new Date(Date.now() - 30 * 86400_000).toISOString();
  const since14d = new Date(Date.now() - 14 * 86400_000).toISOString();

  const [
    paidRes, revRes, sellRes, fiRes, ovRes, expRes, ctaRes, varRes,
  ] = await Promise.all([
    sb.from("v_admin_paid_orders_ops")
      .select("order_id,paid_at,total_cents,currency,buyer_user_id,ops_status,has_grant,item_count,fulfillable_item_count,items")
      .gte("paid_at", since30d)
      .order("paid_at", { ascending: false })
      .limit(500),
    sb.from("v_revenue_health").select("*").maybeSingle(),
    sb.from("v_package_sellability_v1")
      .select("package_id,package_title,pricing_state,gap_class,modules,lessons,lessons_ready,published_locked_cancels_7d")
      .limit(2000),
    sb.from("v_funnel_integrity_check").select("*").maybeSingle(),
    sb.from("v_funnel_conversion_7d").select("*").maybeSingle(),
    sb.from("v_experiment_results")
      .select("experiment_key,experiment_name,experiment_status,variant_key,is_control,layout,price_cents,assignments,conversions,conversion_rate_pct,total_revenue_cents")
      .limit(500),
    sb.from("v_conversion_cta_performance")
      .select("page_path,source,cta_location,variant,views,clicks,ctr_pct,checkout_started,checkout_rate_pct")
      .limit(500),
    sb.from("v_paywall_variant_attribution_drift")
      .select("day,with_variant,without_variant,total,coverage_pct")
      .gte("day", since14d)
      .order("day", { ascending: false })
      .limit(30),
  ]);

  const firstErr = [paidRes, fiRes, ovRes, expRes, ctaRes, varRes].find((r) => r.error);
  if (firstErr?.error) {
    return json({ error: "ssot_view_unavailable", detail: firstErr.error.message }, 500);
  }

  const projection = project({
    paid_orders: (paidRes.data ?? []) as PaidOrderRow[],
    revenue_health: (revRes.data ?? null) as RevenueHealthRow | null,
    sellability: (sellRes.data ?? []) as SellabilityRow[],
    funnel_integrity: (fiRes.data ?? null) as FunnelIntegrityRow | null,
    funnel_overview: (ovRes.data ?? null) as FunnelOverviewRow | null,
    experiments: (expRes.data ?? []) as ExperimentResultRow[],
    cta: (ctaRes.data ?? []) as CtaPerformanceRow[],
    variant_drift: (varRes.data ?? []) as VariantDriftRow[],
    now_iso: new Date().toISOString(),
  });

  return json({ ok: true, projection });
});
