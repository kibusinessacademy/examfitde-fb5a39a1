---
name: Product Health OS 1
description: Deterministic Product/Pricing operator cockpit projecting sellable-vs-public drift, duplicates, Stripe-price gaps, catalog blockers over existing SSOT views; no new tables/cron, read-only.
type: feature
---

# PRODUCT.HEALTH.OS.1 — Product Operator Cockpit

## Scope
Quick-Cut, Architecture-Freeze-konform. Keine neuen Tabellen, keine Trigger, kein Cron.
Pure SSOT-Projektor über 6 bestehende Product/Pricing-Views.

## Inputs (read-only)
- `v_sellable_and_deliverable` — public × delivery_ready × stripe_price Matrix pro Paket
- `v_pricing_gap_audit` — STRIPE_PRICE_ID_MISSING gap_type
- `v_pricing_merge_candidates` — duplicate certifications
- `v_stripe_price_sync_preview` — action_needed (noop/manual_review/sync_required)
- `v_admin_catalog_diagnostics` — block_reason per Beruf
- `v_admin_catalog_teaser_quality` — pct_real_usp pro Kategorie

## Action Queue Heuristik (priority × severity)
1. `PUBLIC_BUT_UNDELIVERABLE` (P=110, critical) — kassiert Geld, kann nicht liefern → SOFORT visibility=private
2. `DUPLICATE_PRODUCT` (P=95) — pro duplicate_product_id: merge auf canonical
3. `STRIPE_PRICE_MISSING` (P=90) — aktiver Preis ohne stripe_price_id → stripe-sync-product
4. `STRIPE_MANUAL_REVIEW` (P=80) — tier mismatch / forced override
5. `PRIVATE_BUT_PRICED` (P=70) — aggregiert: visibility=public Bulk
6. `COURSE_NOT_PUBLISHED` (P=60) — aggregiert
7. `NO_PRICE` (P=55) — aggregiert
8. `LESSONS_GAP_UNKNOWN` (P=40)
9. `TEASER_FALLBACK_HEAVY` (P=35) — pct_real_usp < 0.6 AND entries ≥ 5

Severity weights: critical=4, high=3, medium=2, low=1.

## Suppression / Aggregation
- `PRIVATE_BUT_PRICED`, `NO_PRICE`, `COURSE_NOT_PUBLISHED`, `LESSONS_GAP_UNKNOWN` werden bulk-aggregiert → max. 1 Queue-Item statt 100+
- Per-Row-Items nur für critical/high lever (PUBLIC_BUT_UNDELIVERABLE, DUPLICATE_PRODUCT, STRIPE_PRICE_MISSING, STRIPE_MANUAL_REVIEW)
- Teaser-Kategorien mit < 5 Einträgen werden ausgeschlossen

## Drift Classification (pro Paket)
- `PUBLIC_BUT_UNDELIVERABLE` — visibility=public AND delivery_ready=false → BLOCKER
- `NO_PRICE` — has_stripe_price=false
- `PRIVATE_BUT_PRICED` — has_stripe_price=true AND product_public=false
- `MISSING_STRIPE_PRICE_ID` — DB-Preis ohne Stripe-Ref
- `OK`

## Surfaces
- Edge: `evaluate-product-health` (admin-only, JWT-verified)
- Pure SSOT: `src/lib/productHealth/` mirrored under `supabase/functions/_shared/productHealth/`
- Admin UI: `/admin/governance/product-health`
- Projector version: `product-health-os-1.0.0`

## Verified Baseline
- 442 Pakete in deliverable-Matrix
- **0 PUBLIC_BUT_UNDELIVERABLE** (war 3 vor Stripe-SSOT-Fix — bleibt zu monitoren)
- 226 PRIVATE_BUT_PRICED → größter Conversion-Hebel
- 23 NO_PRICE
- 5 STRIPE_PRICE_ID_MISSING
- 4 DUPLICATE_PRODUCT cases (1 Cluster)
- 5 STRIPE_MANUAL_REVIEW
- 92 COURSE_NOT_PUBLISHED, 46 LESSONS_GAP_UNKNOWN
- sellable_rate ~43%, public_conversion_rate publik/sellable

## Tests
`src/__tests__/product-health/projector.test.ts` — 13 deterministic tests covering
classification, ordering, aggregation, suppression, scoring.
