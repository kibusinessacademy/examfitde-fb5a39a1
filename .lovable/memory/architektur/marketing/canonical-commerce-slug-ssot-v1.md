---
name: Canonical Commerce Slug SSOT v1
description: products.canonical_slug als generated Read-Side-SSOT; fn_derive_canonical_slug ASCII-stable; v_public_sellable_courses exposed canonical_slug; funnel-smoke-daily testet sellable_and_deliverable Set; legacy-recovery bleibt als Bridge
type: feature
---

## Phase 1 — products.canonical_slug

`fn_derive_canonical_slug(text) → text` IMMUTABLE. Frozen Contract:
lowercase + trim → ä/ö/ü→ae/oe/ue + ß→ss → diacritic strip
→ `[/_]+ → -` → strip trailing `-[6-8 hex](-archived-<hex>)?`
→ strip trailing `-frau/-innen/-in` → collapse `--+` → trim leading/trailing dashes
→ strip remaining non-`[a-z0-9-]`.

`products.canonical_slug` = `GENERATED ALWAYS AS (fn_derive_canonical_slug(slug)) STORED`.
Unique index `ux_products_canonical_slug_active` (status='active' partial).
Baseline 2026-05-23: 246 active → 246 unique canonical, 0 collisions.

`v_public_sellable_courses` exposed `canonical_slug` (appended last to keep
view-column-order stable with CREATE OR REPLACE). 191/191 sellable mappend.

## Edge Function Bridge

`create-product-checkout` Strategien (alle ohne hard fail):
1. **canonical_slug** (preferred — SSOT)
2. exact legacy `slug`
3. `recoverProductSlug`: uuid_suffix_strip → normalized → prefix
4. `v_public_sellable_courses` Sicherheitsnetz
5. `suggestClosestSlug` token-overlap → 200+`product_not_found` mit `suggested_url`

Recovery-Bridge bleibt aktiv als Defense-in-Depth — fängt eingehende Altlinks.

## Phase 2 — funnel-smoke-daily (P0.2)

Edge Function `funnel-smoke-daily`. Modes: `full|sample|slugs`.
Test-Set: `v_sellable_and_deliverable.is_sellable_and_deliverable=true`
(NICHT `v_public_sellable_courses` — dort sind 191 Pakete katalog-sichtbar
aber nur 27 wirklich kaufbar wegen `delivery_ready=false`).

Catalog-Drift wird als KPI mitgeführt:
- `catalog_count` (catalog-sichtbare sellable, today=191)
- `catalog_drift_count` (catalog – deliverable, today=164)

Pflicht-Audits über `ops_audit_contract` registriert:
- `funnel_smoke_run_summary` (run_id, total, success, failed)
- `funnel_smoke_alert` (run_id, success_rate, failed_count) — nur bei failed>0
- `commerce_canonical_redirect` (from_slug, to_slug, route) — für Phase 1.5 SPA-301

Auth-Gate: service_role bearer ODER `x-smoke-api-token` ODER `body.source='pg_cron'`.
Smoke-Identität: `e2e+grant@examfit-smoke.local` (Test-Fixture-Contract konform).

Cron `funnel-smoke-daily` 04:30 UTC täglich (anon-JWT pattern wie sibling crons).

## Smoke-Validierung 2026-05-23

`mode=sample n=3` → 3/3 success_rate_pct=100, alle phase=complete.
Resolved-via-canonical-Strategie aktiv (mechatroniker, fachinformatiker-anwendungsentwicklung,
fachkraft-fuer-metalltechnik-fachrichtung-montagetechnik). Stripe-Session-URL
für jeden zurückgeliefert. Catalog-Drift 191→27 als Top-Level-Befund dokumentiert.

## Offene Phase 1.5 (deferred)

- `<CanonicalSlugRedirect>` Komponente: client-side Navigate replace mit Audit
  `commerce_canonical_redirect` wenn URL-Slug ≠ canonical_slug.
- Sitemap-Generator: nur canonical_slug-URLs.
- Helmet-Canonical/og:url: immer canonical_slug.
- BerufeShowcase + interne Links: canonical_slug.
- Heal-Cockpit-Card `FunnelSmokeCard`: letzte 7 Runs, Success-Rate, Top-Failed,
  Re-Run-Button.

Diese sind ohne Funnel-Risiko — Recovery deckt alle Altlinks bereits ab.
Das Daily-Smoke macht jeden Funnel-Bug innerhalb von 24h sichtbar.

## Rollback-Hint

```sql
ALTER TABLE products DROP COLUMN canonical_slug;
DROP INDEX ux_products_canonical_slug_active;
DROP FUNCTION fn_derive_canonical_slug(text);
SELECT cron.unschedule('funnel-smoke-daily');
DELETE FROM ops_audit_contract WHERE action_type IN
  ('commerce_canonical_redirect','funnel_smoke_run_summary','funnel_smoke_alert');
```
