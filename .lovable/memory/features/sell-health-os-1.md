# SELL.HEALTH.OS.1 — Selling Operator Cockpit

**Status:** live · **Owner:** governance · **Version:** sell-health-os-1.0.0

## Why
Selling-System Signale (Revenue, Funnel, Experiments, Sellability, Fulfillment) waren über 8+ Views verstreut. Operator hatte keine
priorisierte Liste **"was kostet uns gerade Geld"**. Reality-Check ergab u. a.:
- 4 von 8 bezahlten Orders der letzten 30d nicht erfüllbar (`ops_status=paid_not_fulfillable`)
- 23 Pakete delivery-ready, aber `packages_ready_unpublished`
- Coverage- und Tracking-Drift unbemerkt

## What
**Pure SSOT Projector** (`src/lib/sellHealth/` + Edge-Spiegel) liest read-only aus:
- `v_admin_paid_orders_ops`
- `v_revenue_health`
- `v_package_sellability_v1`
- `v_funnel_integrity_check`, `v_funnel_conversion_7d`
- `v_experiment_results`
- `v_conversion_cta_performance`
- `v_paywall_variant_attribution_drift`

→ **Edge (read):** `supabase/functions/evaluate-sell-health/` (admin-only, no writes)
→ **Edge (heal):** `supabase/functions/sell-health-act/` — wraps `process_order_paid_fulfillment(order_id)` + `admin_bulk_publish_done_packages(cap, 2490, 24)`. No new business logic.
→ **UI:** `/admin/governance/sell-health` — KPIs + Action Queue + Funnel + Unfulfilled (per-row **Re-grant** Button) + CTA-Underperformer + Toolbar **Bulk-Publish Ready**

## Heuristics (12)
| Code | Severity | Priority |
|---|---|---|
| PAID_NOT_FULFILLABLE | critical | 120 |
| PACKAGE_BLOCKED | high | 95 |
| READY_BUT_UNPUBLISHED | high/medium | 90 |
| PRICING_VIEW_DROUGHT | high | 85 |
| FUNNEL_CONTINUITY_BROKEN | high | 80 |
| CHECKOUT_PARITY_DRIFT | medium | 70 |
| REVENUE_DROUGHT_24H | high | 65 |
| TRACKING_GAP | high | 60 |
| VARIANT_ATTRIBUTION_DRIFT | medium | 55 |
| CTA_HIGH_TRAFFIC_LOW_CONV | medium | 50 |
| LOSING_VARIANT_LIVE | medium | 45 |
| COLD_EXPERIMENT | low | 30 |

Score = `priority × sev_weight` (critical 4 / high 3 / medium 2 / low 1). Deterministisch sortiert.

## Guards
- **No writes, no triggers, no cron.** Pure projection.
- **No content duplication** — alle Quellen sind bestehende SSOT-Views.
- **Admin-only** über `requireAdmin`.
- **12 Unit-Tests** in `src/__tests__/sell-health/projector.test.ts` (Determinismus, Ranking, Schwellwerte).

## Files
- `src/lib/sellHealth/index.ts`
- `supabase/functions/_shared/sellHealth/index.ts`
- `supabase/functions/evaluate-sell-health/index.ts`
- `src/pages/admin/governance/SellHealthPage.tsx`
- `src/__tests__/sell-health/projector.test.ts`
- Route: `src/routes/AppRoutes.tsx` → `/admin/governance/sell-health`
