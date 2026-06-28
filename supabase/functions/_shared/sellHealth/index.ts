/**
 * SELL.HEALTH.OS.1 — Pure deterministic Sales-Operator projector.
 * Read-only aggregation over existing Sales/Funnel/Revenue SSOT views.
 * Input: raw rows. Output: ranked operator signals.
 *
 * Architecture freeze: no new tables, no triggers, no cron. Pure projection.
 */

export const PROJECTOR_VERSION = "sell-health-os-1.0.0";

// --- Inputs -----------------------------------------------------------------

export interface PaidOrderRow {
  order_id: string;
  paid_at: string | null;
  total_cents: number | null;
  currency: string | null;
  buyer_user_id: string | null;
  ops_status: string | null; // 'granted' | 'paid_not_fulfillable' | ...
  has_grant: boolean | null;
  item_count: number | null;
  fulfillable_item_count: number | null;
  items: unknown;
}

export interface RevenueHealthRow {
  orders_30d: number | null;
  revenue_30d_eur: number | null;
  revenue_7d_eur: number | null;
  revenue_today_eur: number | null;
  refunds_30d: number | null;
  packages_ready_unpublished: number | null;
  packages_blocked: number | null;
  high_churn_users: number | null;
}

export interface SellabilityRow {
  package_id: string;
  package_title: string | null;
  pricing_state: string | null;
  gap_class: string | null;
  modules: number | null;
  lessons: number | null;
  lessons_ready: number | null;
  published_locked_cancels_7d: number | null;
}

export interface FunnelIntegrityRow {
  status: string | null;
  strict_events_total: number | null;
  strict_events_with_pkg: number | null;
  tracking_completeness_pct: number | null;
  tracking_completeness_status: string | null;
  s1_lead_magnet: number | null;
  s2_quiz_started: number | null;
  s3_quiz_completed: number | null;
  s4_lead_capture: number | null;
  s5_checkout: number | null;
  funnel_continuity_status: string | null;
  persona_coverage_pct: number | null;
  source_coverage_pct: number | null;
  attribution_quality_status: string | null;
  events_total_7d: number | null;
}

export interface FunnelOverviewRow {
  paid_orders_24h: number | null;
  checkout_complete_24h: number | null;
  checkout_started_24h: number | null;
  pricing_view_24h: number | null;
  checkout_complete_parity_pct: number | null;
  status: string | null;
  pricing_view_drought: boolean | null;
}

export interface ExperimentResultRow {
  experiment_key: string;
  experiment_name: string | null;
  experiment_status: string | null;
  variant_key: string;
  is_control: boolean | null;
  layout: string | null;
  price_cents: number | null;
  assignments: number | null;
  conversions: number | null;
  conversion_rate_pct: number | null;
  total_revenue_cents: number | null;
}

export interface CtaPerformanceRow {
  page_path: string | null;
  source: string | null;
  cta_location: string | null;
  variant: string | null;
  views: number | null;
  clicks: number | null;
  ctr_pct: number | null;
  checkout_started: number | null;
  checkout_rate_pct: number | null;
}

export interface VariantDriftRow {
  day: string | null;
  with_variant: number | null;
  without_variant: number | null;
  total: number | null;
  coverage_pct: number | null;
}

export interface ProjInputs {
  paid_orders: PaidOrderRow[];
  revenue_health: RevenueHealthRow | null;
  sellability: SellabilityRow[];
  funnel_integrity: FunnelIntegrityRow | null;
  funnel_overview: FunnelOverviewRow | null;
  experiments: ExperimentResultRow[];
  cta: CtaPerformanceRow[];
  variant_drift: VariantDriftRow[];
  now_iso: string;
}

// --- Outputs ----------------------------------------------------------------

export type ActionCode =
  | "PAID_NOT_FULFILLABLE"        // money charged, no grant — CRITICAL
  | "READY_BUT_UNPUBLISHED"       // packages delivery-ready but hidden — pure revenue lever
  | "PACKAGE_BLOCKED"             // package blocked from selling
  | "PRICING_VIEW_DROUGHT"        // no pricing views = funnel/SEO broken
  | "FUNNEL_CONTINUITY_BROKEN"    // s1>s2>... ordering broken
  | "TRACKING_GAP"                // events without package_id ≥ 15%
  | "VARIANT_ATTRIBUTION_DRIFT"   // <90% with_variant coverage
  | "COLD_EXPERIMENT"             // active experiment, 0 assignments
  | "LOSING_VARIANT_LIVE"         // variant w/ <50% of control CR
  | "CTA_HIGH_TRAFFIC_LOW_CONV"   // many clicks, near-zero checkout
  | "CHECKOUT_PARITY_DRIFT"       // pricing_view vs checkout parity ≠ healthy
  | "REVENUE_DROUGHT_24H";        // 0 paid orders, traffic present

export type Severity = "critical" | "high" | "medium" | "low";

export interface ActionItem {
  code: ActionCode;
  severity: Severity;
  target: string;
  metric: number;
  detail: string;
  recommendation: string;
  score: number;
}

export interface Projection {
  generated_at: string;
  projector_version: string;
  totals: {
    orders_24h_paid: number;
    orders_paid_not_fulfillable: number;
    orders_paid_not_fulfillable_pct: number;
    revenue_today_eur: number;
    revenue_7d_eur: number;
    revenue_30d_eur: number;
    refunds_30d: number;
    packages_ready_unpublished: number;
    packages_blocked: number;
    checkout_started_24h: number;
    checkout_complete_24h: number;
    pricing_view_24h: number;
    checkout_completion_rate: number; // complete / started
    funnel_continuity_status: string;
    tracking_completeness_pct: number;
    variant_coverage_pct: number;
    cold_experiments: number;
    sellable_revenue_potential_eur: number; // 24.90 * ready_unpublished (default ticket)
  };
  action_queue: ActionItem[];
  funnel_steps: { step: string; count: number }[];
  experiments: ExperimentResultRow[];
  top_cta_underperformers: CtaPerformanceRow[];
  unfulfilled_orders: PaidOrderRow[];
}

// --- Heuristics -------------------------------------------------------------

const PRIORITY: Record<ActionCode, number> = {
  PAID_NOT_FULFILLABLE: 120,        // we have their money. fix first.
  PACKAGE_BLOCKED: 95,
  READY_BUT_UNPUBLISHED: 90,        // single biggest revenue lever
  PRICING_VIEW_DROUGHT: 85,
  FUNNEL_CONTINUITY_BROKEN: 80,
  CHECKOUT_PARITY_DRIFT: 70,
  REVENUE_DROUGHT_24H: 65,
  TRACKING_GAP: 60,
  VARIANT_ATTRIBUTION_DRIFT: 55,
  CTA_HIGH_TRAFFIC_LOW_CONV: 50,
  LOSING_VARIANT_LIVE: 45,
  COLD_EXPERIMENT: 30,
};

const SEV_WEIGHT = { critical: 4, high: 3, medium: 2, low: 1 } as const;

const DEFAULT_TICKET_EUR = 24.9;

export function buildActionQueue(p: Omit<ProjInputs, "now_iso">): ActionItem[] {
  const items: ActionItem[] = [];

  // 1. PAID_NOT_FULFILLABLE — one per order, critical
  for (const o of p.paid_orders) {
    if (o.ops_status === "paid_not_fulfillable" || o.has_grant === false) {
      items.push({
        code: "PAID_NOT_FULFILLABLE",
        severity: "critical",
        target: o.order_id,
        metric: (o.total_cents ?? 0) / 100,
        detail: `Order ${o.order_id.slice(0, 8)} bezahlt (${((o.total_cents ?? 0) / 100).toFixed(2)} €) — kein Grant`,
        recommendation: "grant_learner_course_access manuell triggern oder Refund einleiten",
        score: 0,
      });
    }
  }

  // 2. READY_BUT_UNPUBLISHED — aggregated
  const ready = p.revenue_health?.packages_ready_unpublished ?? 0;
  if (ready > 0) {
    items.push({
      code: "READY_BUT_UNPUBLISHED",
      severity: ready >= 10 ? "high" : "medium",
      target: "catalog",
      metric: ready,
      detail: `${ready} Pakete delivery-ready aber unveröffentlicht (~${(ready * DEFAULT_TICKET_EUR).toFixed(0)} € pro Verkauf)`,
      recommendation: "Bulk-Promote zu published in /admin/tools/bulk-course-export",
      score: 0,
    });
  }

  const blocked = p.revenue_health?.packages_blocked ?? 0;
  if (blocked > 0) {
    items.push({
      code: "PACKAGE_BLOCKED",
      severity: "high",
      target: "catalog",
      metric: blocked,
      detail: `${blocked} Pakete blockiert (Pricing/Delivery/Quality)`,
      recommendation: "Block-Reasons in v_package_sellability_v1 prüfen",
      score: 0,
    });
  }

  // 3. PRICING_VIEW_DROUGHT
  if (p.funnel_overview?.pricing_view_drought === true) {
    items.push({
      code: "PRICING_VIEW_DROUGHT",
      severity: "high",
      target: "funnel",
      metric: p.funnel_overview.pricing_view_24h ?? 0,
      detail: "Keine pricing_view-Events in 24h — Tracking oder Funnel-Eintritt gebrochen",
      recommendation: "Event-Wiring auf /preise + Bundle-CTA prüfen",
      score: 0,
    });
  }

  // 4. FUNNEL_CONTINUITY_BROKEN
  const fi = p.funnel_integrity;
  if (fi && fi.funnel_continuity_status && fi.funnel_continuity_status !== "ok") {
    items.push({
      code: "FUNNEL_CONTINUITY_BROKEN",
      severity: "high",
      target: "funnel",
      metric: 1,
      detail: `Funnel s1→s5 nicht monoton (${fi.funnel_continuity_status}): ${[fi.s1_lead_magnet, fi.s2_quiz_started, fi.s3_quiz_completed, fi.s4_lead_capture, fi.s5_checkout].join("→")}`,
      recommendation: "Event-Reihenfolge + emitFunnelEvent-Pflichtfelder prüfen",
      score: 0,
    });
  }

  // 5. TRACKING_GAP — completeness <85 means strict events missing package_id
  if (fi && (fi.tracking_completeness_pct ?? 100) < 85) {
    items.push({
      code: "TRACKING_GAP",
      severity: "high",
      target: "tracking",
      metric: fi.tracking_completeness_pct ?? 0,
      detail: `Nur ${(fi.tracking_completeness_pct ?? 0).toFixed(1)}% strikter Events tragen package_id`,
      recommendation: "package_id-Pflichtfelder in emitFunnelEvent prüfen (Loop A)",
      score: 0,
    });
  }

  // 6. VARIANT_ATTRIBUTION_DRIFT — latest day coverage <90
  const latestDrift = [...p.variant_drift].sort((a, b) => String(b.day ?? "").localeCompare(String(a.day ?? "")))[0];
  if (latestDrift && (latestDrift.coverage_pct ?? 100) < 90) {
    items.push({
      code: "VARIANT_ATTRIBUTION_DRIFT",
      severity: "medium",
      target: "paywall_experiments",
      metric: latestDrift.coverage_pct ?? 0,
      detail: `Variant-Coverage ${(latestDrift.coverage_pct ?? 0).toFixed(1)}% (${latestDrift.without_variant ?? 0} ohne Variant)`,
      recommendation: "assign_paywall_variant Aufruf vor Konversionspunkten erzwingen",
      score: 0,
    });
  }

  // 7. COLD_EXPERIMENT
  for (const e of p.experiments) {
    if (e.experiment_status === "active" && (e.assignments ?? 0) === 0 && e.is_control === true) {
      items.push({
        code: "COLD_EXPERIMENT",
        severity: "low",
        target: e.experiment_key,
        metric: 0,
        detail: `Experiment "${e.experiment_name ?? e.experiment_key}" aktiv mit 0 Assignments`,
        recommendation: "Trigger-Punkt für resolve-paywall verdrahten oder Experiment pausieren",
        score: 0,
      });
    }
  }

  // 8. LOSING_VARIANT_LIVE
  const byExp = new Map<string, ExperimentResultRow[]>();
  for (const e of p.experiments) {
    if (e.experiment_status !== "active") continue;
    const arr = byExp.get(e.experiment_key) ?? [];
    arr.push(e);
    byExp.set(e.experiment_key, arr);
  }
  for (const [key, variants] of byExp) {
    const ctrl = variants.find((v) => v.is_control === true);
    if (!ctrl || (ctrl.assignments ?? 0) < 30) continue;
    for (const v of variants) {
      if (v.is_control) continue;
      if ((v.assignments ?? 0) < 30) continue;
      const ctrlCr = ctrl.conversion_rate_pct ?? 0;
      const vCr = v.conversion_rate_pct ?? 0;
      if (ctrlCr > 0 && vCr < ctrlCr * 0.5) {
        items.push({
          code: "LOSING_VARIANT_LIVE",
          severity: "medium",
          target: `${key}/${v.variant_key}`,
          metric: vCr,
          detail: `Variant "${v.variant_key}" CR ${vCr.toFixed(2)}% vs Control ${ctrlCr.toFixed(2)}%`,
          recommendation: "Variant pausieren oder Traffic auf Control rebalancieren",
          score: 0,
        });
      }
    }
  }

  // 9. CTA_HIGH_TRAFFIC_LOW_CONV
  for (const c of p.cta) {
    const clicks = c.clicks ?? 0;
    const checkoutRate = c.checkout_rate_pct ?? 0;
    if (clicks >= 50 && checkoutRate < 1) {
      items.push({
        code: "CTA_HIGH_TRAFFIC_LOW_CONV",
        severity: "medium",
        target: `${c.page_path ?? "?"}#${c.cta_location ?? "?"}`,
        metric: clicks,
        detail: `${clicks} Klicks, Checkout-Rate ${checkoutRate.toFixed(2)}% (Variant ${c.variant ?? "?"})`,
        recommendation: "CTA-Copy/Position oder Pricing-Display prüfen",
        score: 0,
      });
    }
  }

  // 10. CHECKOUT_PARITY_DRIFT
  const ov = p.funnel_overview;
  if (ov && ov.status && ov.status !== "ok" && ov.status !== "healthy" && !ov.pricing_view_drought) {
    items.push({
      code: "CHECKOUT_PARITY_DRIFT",
      severity: "medium",
      target: "checkout",
      metric: ov.checkout_complete_parity_pct ?? 0,
      detail: `Parity status=${ov.status} (parity ${(ov.checkout_complete_parity_pct ?? 0).toFixed(1)}%)`,
      recommendation: "Webhook stripe-webhook + checkout.completed Events prüfen",
      score: 0,
    });
  }

  // 11. REVENUE_DROUGHT_24H
  if (ov && (ov.paid_orders_24h ?? 0) === 0 && (ov.pricing_view_24h ?? 0) > 50) {
    items.push({
      code: "REVENUE_DROUGHT_24H",
      severity: "high",
      target: "revenue",
      metric: ov.pricing_view_24h ?? 0,
      detail: `${ov.pricing_view_24h} Pricing-Views, 0 bezahlte Orders in 24h`,
      recommendation: "Checkout-Surface / Stripe-Pricing live verifizieren",
      score: 0,
    });
  }

  // score + sort
  for (const it of items) {
    it.score = PRIORITY[it.code] * SEV_WEIGHT[it.severity];
  }
  items.sort((a, b) =>
    b.score - a.score || a.code.localeCompare(b.code) || a.target.localeCompare(b.target),
  );
  return items;
}

export function project(inputs: ProjInputs): Projection {
  const rh = inputs.revenue_health;
  const ov = inputs.funnel_overview;
  const fi = inputs.funnel_integrity;

  const paidUnfulfilled = inputs.paid_orders.filter(
    (o) => o.ops_status === "paid_not_fulfillable" || o.has_grant === false,
  );
  const totalPaid = inputs.paid_orders.length || 0;
  const latestDrift = [...inputs.variant_drift].sort((a, b) =>
    String(b.day ?? "").localeCompare(String(a.day ?? "")),
  )[0];
  const ready = rh?.packages_ready_unpublished ?? 0;

  const checkoutStarted = ov?.checkout_started_24h ?? 0;
  const checkoutComplete = ov?.checkout_complete_24h ?? 0;
  const checkoutCompletion = checkoutStarted > 0 ? checkoutComplete / checkoutStarted : 0;

  return {
    generated_at: inputs.now_iso,
    projector_version: PROJECTOR_VERSION,
    totals: {
      orders_24h_paid: ov?.paid_orders_24h ?? 0,
      orders_paid_not_fulfillable: paidUnfulfilled.length,
      orders_paid_not_fulfillable_pct: totalPaid > 0 ? paidUnfulfilled.length / totalPaid : 0,
      revenue_today_eur: rh?.revenue_today_eur ?? 0,
      revenue_7d_eur: rh?.revenue_7d_eur ?? 0,
      revenue_30d_eur: rh?.revenue_30d_eur ?? 0,
      refunds_30d: rh?.refunds_30d ?? 0,
      packages_ready_unpublished: ready,
      packages_blocked: rh?.packages_blocked ?? 0,
      checkout_started_24h: checkoutStarted,
      checkout_complete_24h: checkoutComplete,
      pricing_view_24h: ov?.pricing_view_24h ?? 0,
      checkout_completion_rate: checkoutCompletion,
      funnel_continuity_status: fi?.funnel_continuity_status ?? "unknown",
      tracking_completeness_pct: fi?.tracking_completeness_pct ?? 0,
      variant_coverage_pct: latestDrift?.coverage_pct ?? 0,
      cold_experiments: inputs.experiments.filter(
        (e) => e.experiment_status === "active" && (e.assignments ?? 0) === 0 && e.is_control === true,
      ).length,
      sellable_revenue_potential_eur: ready * DEFAULT_TICKET_EUR,
    },
    action_queue: buildActionQueue(inputs),
    funnel_steps: fi
      ? [
          { step: "s1_lead_magnet", count: fi.s1_lead_magnet ?? 0 },
          { step: "s2_quiz_started", count: fi.s2_quiz_started ?? 0 },
          { step: "s3_quiz_completed", count: fi.s3_quiz_completed ?? 0 },
          { step: "s4_lead_capture", count: fi.s4_lead_capture ?? 0 },
          { step: "s5_checkout", count: fi.s5_checkout ?? 0 },
        ]
      : [],
    experiments: inputs.experiments,
    top_cta_underperformers: [...inputs.cta]
      .filter((c) => (c.clicks ?? 0) >= 20 && (c.checkout_rate_pct ?? 0) < 2)
      .sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0))
      .slice(0, 10),
    unfulfilled_orders: paidUnfulfilled.slice(0, 20),
  };
}
