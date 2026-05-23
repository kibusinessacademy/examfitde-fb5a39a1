---
name: Commerce Truth Bridge Consolidation v1
description: v_sellable_and_deliverable wurde von v_course_delivery_readiness (V1, minichecks) auf v_package_customer_safe_v1 (V2 SSOT) umgestellt. Drift 164→1, sellable 27→190.
type: feature
---

## Entscheidung 2026-05-23

`v_sellable_and_deliverable` ist Commerce-Truth-SSOT — darf nur aus
gehärteter Käufer-Wahrheit (`v_package_customer_safe_v1`) gespeist werden.

**Vorher:** LEFT JOIN auf `v_course_delivery_readiness.delivery_ready`
→ `minichecks_unready` blockte 163 Pakete obwohl nicht buyer-kritisch.
Resultat: 27/190 sellable_and_deliverable bei 190 customer_safe = harter Drift.

**Nachher:**
- `delivery_ready` = `csv.customer_safe`
- `delivery_blocking_reasons` = `csv.delivery_blocking_reasons`
- `is_sellable_and_deliverable` zusätzlich gegated durch:
  - `is_published`
  - `customer_safe`
  - `products.status='active' AND visibility='public' AND canonical_slug NOT NULL`
  - mind. ein aktiver `product_prices.stripe_price_id`

## Resultat (Baseline 2026-05-23)

| KPI                              | Vorher | Nachher |
|----------------------------------|-------:|--------:|
| `is_sellable_and_deliverable`    |     27 |     190 |
| `customer_safe`                  |    190 |     190 |
| `catalog_drift_count` (Smoke)    |    164 |       1 |

Smoke `funnel-smoke-daily mode=sample n=10`: **10/10 success, 0 failed**.

Smoke `funnel-smoke-daily mode=slugs` 5 Batches × 40 Slugs:
**190/190 success, 0 failed, alle phase=complete** (cs_live_* via create-product-checkout).
Run-IDs: 9c023847, 52e5ffaa, 7d3f76a1, 89cdb2e5, b2729e87.

## Catalog Pairing Repair (P0.4, 2026-05-23)

Orphan-Produkt `860eefac-db8e-4c10-8783-8cf585b41d20`
(slug `examfit-medizinische-r-fachangestellte-r-e96bc7b7`, Feb 2026, 0 Bestellungen)
war Duplikat der aktiven, gepairten `medizinische-r-fachangestellte-r-11b697be`
(Apr 2026, paired course_package `11b697be-07a8-4164-ab1b-a8747ec49b03`).
Orphan auf `status='archived'` → fällt aus `v_public_sellable_courses` raus.
Audit `commerce_catalog_orphan_archived_v1` (registriert 2026-05-23) + Eintrag.

**Resultat: catalog 191→190 = commerce 190 = 0 Drift.**

## V1 nicht gelöscht

`v_course_delivery_readiness` bleibt als Diagnose-View. Konsumenten:
- `admin_get_course_delivery_readiness` (Admin-Diagnose) — allowed
- `v_package_delivery_readiness_v2` (Diagnose v2) — allowed
- `fn_post_purchase_first_lesson_probe` — Post-Purchase, nicht Checkout-Gate
- `v_commerce_gap_classification` (downstream of new v_sellable_and_deliverable) — bridged

Beide Views haben `COMMENT ON VIEW` mit DEPRECATED-Hinweis bzw. neuer Source-Truth.

## Grep-Ergebnis App-Code

Außerhalb auto-generierter `src/integrations/supabase/types.ts` referenziert
**kein** Edge-Function- oder UI-Code direkt `v_course_delivery_readiness` oder
`v_sellable_and_deliverable`. Checkout-Konsumenten lesen `v_public_sellable_courses`
+ `products` direkt. Bridge-Migration ist daher schemaseitig vollständig.

## Audit

`commerce_truth_bridge_consolidated_v1` registriert in `ops_audit_contract`.
Pflicht-Keys: `before_sellable_and_deliverable`, `after_sellable_and_deliverable`,
`source_truth`, `deprecated_truth`. Ein-Migrations-Audit geschrieben.

## Rollback

```sql
CREATE OR REPLACE VIEW public.v_sellable_and_deliverable AS
SELECT cp.id AS course_package_id, cp.curriculum_id, cp.product_id, cp.status AS package_status,
       cp.is_published, dr.delivery_ready, dr.blocking_reasons AS delivery_blocking_reasons,
       (...product_public...), (...has_stripe_price...),
       cp.is_published AND dr.delivery_ready AND ... AS is_sellable_and_deliverable
FROM course_packages cp LEFT JOIN v_course_delivery_readiness dr ON dr.course_package_id=cp.id
WHERE cp.archived=false;
```
