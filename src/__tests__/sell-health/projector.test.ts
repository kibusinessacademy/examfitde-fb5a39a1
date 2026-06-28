import { describe, it, expect } from "vitest";
import { project, buildActionQueue } from "@/lib/sellHealth";

const now = "2025-01-01T00:00:00.000Z";
const baseInputs = {
  paid_orders: [],
  revenue_health: null,
  sellability: [],
  funnel_integrity: null,
  funnel_overview: null,
  experiments: [],
  cta: [],
  variant_drift: [],
  now_iso: now,
};

describe("SELL.HEALTH.OS.1 projector", () => {
  it("empty projection is deterministic", () => {
    const a = project(baseInputs);
    const b = project(baseInputs);
    expect(a).toEqual(b);
    expect(a.action_queue).toEqual([]);
    expect(a.projector_version).toMatch(/^sell-health-os-/);
  });

  it("flags PAID_NOT_FULFILLABLE as critical, top priority", () => {
    const p = project({
      ...baseInputs,
      paid_orders: [
        { order_id: "o-aaaaaaaa-1", paid_at: now, total_cents: 2490, currency: "EUR", buyer_user_id: "u1", ops_status: "paid_not_fulfillable", has_grant: false, item_count: 1, fulfillable_item_count: 0, items: null },
        { order_id: "o-bbbbbbbb-2", paid_at: now, total_cents: 2490, currency: "EUR", buyer_user_id: "u2", ops_status: "granted", has_grant: true, item_count: 1, fulfillable_item_count: 1, items: null },
      ],
    });
    expect(p.totals.orders_paid_not_fulfillable).toBe(1);
    expect(p.action_queue[0].code).toBe("PAID_NOT_FULFILLABLE");
    expect(p.action_queue[0].severity).toBe("critical");
  });

  it("READY_BUT_UNPUBLISHED beats COLD_EXPERIMENT in ranking", () => {
    const p = project({
      ...baseInputs,
      revenue_health: { orders_30d: 0, revenue_30d_eur: 0, revenue_7d_eur: 0, revenue_today_eur: 0, refunds_30d: 0, packages_ready_unpublished: 23, packages_blocked: 0, high_churn_users: 0 },
      experiments: [
        { experiment_key: "e1", experiment_name: "E1", experiment_status: "active", variant_key: "control", is_control: true, layout: null, price_cents: 2490, assignments: 0, conversions: 0, conversion_rate_pct: 0, total_revenue_cents: 0 },
      ],
    });
    const codes = p.action_queue.map((a) => a.code);
    expect(codes.indexOf("READY_BUT_UNPUBLISHED")).toBeLessThan(codes.indexOf("COLD_EXPERIMENT"));
    expect(p.totals.sellable_revenue_potential_eur).toBeCloseTo(23 * 24.9, 5);
  });

  it("detects FUNNEL_CONTINUITY_BROKEN + TRACKING_GAP", () => {
    const items = buildActionQueue({
      ...baseInputs,
      funnel_integrity: {
        status: null, strict_events_total: 100, strict_events_with_pkg: 50,
        tracking_completeness_pct: 50, tracking_completeness_status: "low",
        s1_lead_magnet: 100, s2_quiz_started: 200, s3_quiz_completed: 50, s4_lead_capture: 0, s5_checkout: 1,
        funnel_continuity_status: "broken", persona_coverage_pct: 0, source_coverage_pct: 0,
        attribution_quality_status: "low", events_total_7d: 100,
      },
    });
    expect(items.find((i) => i.code === "FUNNEL_CONTINUITY_BROKEN")).toBeTruthy();
    expect(items.find((i) => i.code === "TRACKING_GAP")).toBeTruthy();
  });

  it("PRICING_VIEW_DROUGHT triggered by overview flag", () => {
    const items = buildActionQueue({
      ...baseInputs,
      funnel_overview: { paid_orders_24h: 0, checkout_complete_24h: 0, checkout_started_24h: 0, pricing_view_24h: 0, checkout_complete_parity_pct: 0, status: "drought", pricing_view_drought: true },
    });
    expect(items[0].code).toBe("PRICING_VIEW_DROUGHT");
  });

  it("VARIANT_ATTRIBUTION_DRIFT uses latest day only", () => {
    const items = buildActionQueue({
      ...baseInputs,
      variant_drift: [
        { day: "2025-01-01", with_variant: 10, without_variant: 90, total: 100, coverage_pct: 10 },
        { day: "2024-12-01", with_variant: 95, without_variant: 5, total: 100, coverage_pct: 95 },
      ],
    });
    const drift = items.find((i) => i.code === "VARIANT_ATTRIBUTION_DRIFT");
    expect(drift).toBeTruthy();
    expect(drift?.metric).toBe(10);
  });

  it("LOSING_VARIANT_LIVE needs minimum samples", () => {
    const items = buildActionQueue({
      ...baseInputs,
      experiments: [
        { experiment_key: "x", experiment_name: "X", experiment_status: "active", variant_key: "control", is_control: true, layout: null, price_cents: 2490, assignments: 100, conversions: 10, conversion_rate_pct: 10, total_revenue_cents: 0 },
        { experiment_key: "x", experiment_name: "X", experiment_status: "active", variant_key: "v2", is_control: false, layout: null, price_cents: 2490, assignments: 100, conversions: 1, conversion_rate_pct: 1, total_revenue_cents: 0 },
        { experiment_key: "x", experiment_name: "X", experiment_status: "active", variant_key: "small", is_control: false, layout: null, price_cents: 2490, assignments: 5, conversions: 0, conversion_rate_pct: 0, total_revenue_cents: 0 },
      ],
    });
    const losing = items.filter((i) => i.code === "LOSING_VARIANT_LIVE");
    expect(losing).toHaveLength(1);
    expect(losing[0].target).toBe("x/v2");
  });

  it("CTA_HIGH_TRAFFIC_LOW_CONV only above threshold", () => {
    const items = buildActionQueue({
      ...baseInputs,
      cta: [
        { page_path: "/x", source: null, cta_location: "hero", variant: "A", views: 1000, clicks: 200, ctr_pct: 20, checkout_started: 1, checkout_rate_pct: 0.5 },
        { page_path: "/y", source: null, cta_location: "hero", variant: "A", views: 1000, clicks: 10, ctr_pct: 1, checkout_started: 0, checkout_rate_pct: 0 },
      ],
    });
    const cta = items.filter((i) => i.code === "CTA_HIGH_TRAFFIC_LOW_CONV");
    expect(cta).toHaveLength(1);
    expect(cta[0].target).toContain("/x");
  });

  it("REVENUE_DROUGHT_24H requires traffic but no orders", () => {
    const items = buildActionQueue({
      ...baseInputs,
      funnel_overview: { paid_orders_24h: 0, checkout_complete_24h: 0, checkout_started_24h: 5, pricing_view_24h: 200, checkout_complete_parity_pct: 100, status: "ok", pricing_view_drought: false },
    });
    expect(items.find((i) => i.code === "REVENUE_DROUGHT_24H")).toBeTruthy();
  });

  it("ranking: critical > high > medium > low at equal priority", () => {
    const p = project({
      ...baseInputs,
      paid_orders: [
        { order_id: "oA", paid_at: now, total_cents: 100, currency: "EUR", buyer_user_id: "u", ops_status: "paid_not_fulfillable", has_grant: false, item_count: 1, fulfillable_item_count: 0, items: null },
      ],
      revenue_health: { orders_30d: 0, revenue_30d_eur: 0, revenue_7d_eur: 0, revenue_today_eur: 0, refunds_30d: 0, packages_ready_unpublished: 1, packages_blocked: 0, high_churn_users: 0 },
      experiments: [{ experiment_key: "e", experiment_name: null, experiment_status: "active", variant_key: "control", is_control: true, layout: null, price_cents: 0, assignments: 0, conversions: 0, conversion_rate_pct: 0, total_revenue_cents: 0 }],
    });
    expect(p.action_queue[0].code).toBe("PAID_NOT_FULFILLABLE");
    expect(p.action_queue[p.action_queue.length - 1].code).toBe("COLD_EXPERIMENT");
  });

  it("unfulfilled_orders capped at 20", () => {
    const orders = Array.from({ length: 30 }, (_, i) => ({
      order_id: `o-${i}`, paid_at: now, total_cents: 100, currency: "EUR", buyer_user_id: "u", ops_status: "paid_not_fulfillable", has_grant: false, item_count: 1, fulfillable_item_count: 0, items: null,
    }));
    const p = project({ ...baseInputs, paid_orders: orders });
    expect(p.unfulfilled_orders).toHaveLength(20);
    expect(p.totals.orders_paid_not_fulfillable).toBe(30);
  });
});
