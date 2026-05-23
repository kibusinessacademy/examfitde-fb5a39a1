## Ziel

Aus dem Recovery-Symptomfix wird die strukturelle Lösung:
- **Eine** öffentliche Identity pro Produkt (`canonical_slug`)
- Alle Altlinks → 301 → canonical
- Nur canonical liefert dauerhaft 200
- Tägliche Funnel-Verifikation aller 191 sellable Pakete inkl. echter Stripe-Sessions

## Phase 1 — `products.canonical_slug` als Read-Side-SSOT

### DB-Schema (Migration, ein Concern)

```sql
-- 1. Helper: deterministische, stabile, ASCII-normalisierte Ableitung
--    aus products.slug (nicht aus title — title-Drift verboten).
--    Frozen contract: ä→ae, ö→oe, ü→ue, ß→ss, NFKD strip, UUID-Suffix weg,
--    /-_ → -, doppelte - kollabiert, lowercase, trim.
CREATE OR REPLACE FUNCTION public.fn_derive_canonical_slug(_raw text)
RETURNS text LANGUAGE sql IMMUTABLE …;

-- 2. STORED generated column (SSOT für Routing/Checkout/Tracking/SEO)
ALTER TABLE public.products
  ADD COLUMN canonical_slug text
  GENERATED ALWAYS AS (public.fn_derive_canonical_slug(slug)) STORED;

-- 3. Unique-Index auf active Produkte. Bricht bei Kollision → Audit + Fix
CREATE UNIQUE INDEX ux_products_canonical_slug_active
  ON public.products(canonical_slug) WHERE status='active';
```

Falls Index bricht: kollidierende active Slugs zuerst manuell trennen (würde sehr selten passieren — Recovery-Smoke sah keine).

### Read-Side SSOT

- `v_public_sellable_courses`: zusätzlich `canonical_slug` exposen (legacy `slug` bleibt für eine Übergangsphase).
- Alle App-Reads (`ProductPage`, `PersonaLandingPage`, `DynamicProductLandingPage`, `BerufeShowcase`, Sitemap-Generator) lesen `canonical_slug`.
- `create-product-checkout` Edge Function nimmt `canonical_slug` als bevorzugten Lookup; Recovery bleibt Fallback.

### Routing + 301 (SPA)

- Neue Komponente `<CanonicalSlugRedirect>` an Top-Level der Produktrouten:
  Wenn `urlSlug !== canonical_slug` → `<Navigate to=… replace />` + `<meta name="prerender-status-code" content="301">` + Audit `commerce_canonical_redirect`.
- Hosting: `_redirects`/`vercel.json` regeln nur statische Edge-Cases — Lovable-Hosting kennt kein Server-301; UI-Navigate ist die SSOT für Now. Vercel-Migration kann später echte 301 setzen (Runbook bereits vorhanden).

### SEO-Konsolidierung

- `<link rel="canonical">` (Helmet) → IMMER `canonical_slug`-URL.
- `og:url`, JSON-LD `@id`, Breadcrumbs → IMMER canonical.
- Sitemap-Generator: nur canonical_slug-URLs ausgeben, niemals Legacy.
- Internal Links (`BerufeShowcase`, Persona-Pages, Pillars) → canonical_slug.

### Tracking-/Analytics-Konsolidierung

- `conversion_events`: `metadata.product_slug` und Edge-Function-Audit nur canonical schreiben.
- Recovery-Audit (`checkout_slug_recovered`) bleibt — markiert Drift, der durch externen Link kommt.

## Phase 2 — Daily Funnel Smoke (P0.2)

### Architektur

- **Edge Function** `funnel-smoke-daily` (service-role only):
  1. Lädt alle 191 aus `v_public_sellable_courses`
  2. Pro Slug: GET `/paket/<canonical_slug>` (status check) → POST `create-product-checkout` mit Test-Identität → erwartet `cs_live_*` Stripe Session URL
  3. Schreibt Ergebnis in neue Tabelle `funnel_smoke_runs` (run_id, slug, phase, success, duration_ms, error_code)
  4. Aggregat-Audit `funnel_smoke_run_summary` mit Success-Rate
  5. **Stripe-Cleanup**: Erzeugte Sessions sind unbezahlt und expiren nach 24h automatisch — kein DB-Cleanup nötig; aber Smoke-Identität bekommt `metadata.smoke_run_id` damit Stripe Dashboard sie als Smoke-Traffic erkennt.

- **Test-User**: bestehender `e2e+grant@examfit-smoke.local` (Test-Fixture-Contract konform).

- **Cron**: `pg_cron` 1×/Tag 04:30 UTC ruft Edge Function via `net.http_post`. Audit-Kontrakt registriert.

- **Alert**: Wenn `success_rate < 100%` → Pflicht-Audit `funnel_smoke_alert` + Eintrag in `heal_alert_notifications` (existierende Outbox).

### UI

- Card `FunnelSmokeCard` im Heal-Cockpit: letzte 7 Runs, Success-Rate, Top-Failed-Slugs, broken-slug-snapshot, Re-Run-Button.

## Architectural Continuity Guard

Pflichtcheck vor Migration: dies erfüllt
- **EXTEND_EXISTING** (generated column statt neuer Spalte)
- **NO_PARALLEL_SYSTEMS** (`canonical_slug` ersetzt `slug` als SSOT, Legacy bleibt nur als Bridge)
- **AUDITABLE_MUTATIONS** (Recovery + Redirect + Smoke alle in `auto_heal_log`)
- **GOVERNANCE_BEFORE_AUTOMATION** (Cron erst nach Smoke validierter Edge-Function)

## Tests

- Neue Vitest: `fn_derive_canonical_slug` Eigenschaftstabelle (Umlaut, UUID-Suffix, doppelte Bindestriche, leading/trailing).
- Vitest: `<CanonicalSlugRedirect>` rendert Navigate bei Drift, no-op bei match.
- Deno: `funnel-smoke-daily` Smoke-Mode mit 3 Slugs (CI), Full-Mode 191 nur via Cron.
- Bestehender 191-Slug-Smoke wird Teil der Edge Function.

## Rollout

1. Migration `canonical_slug` + Unique-Index (Approval-Pflicht).
2. Edge-Function-Updates (`create-product-checkout`, neuer `funnel-smoke-daily`).
3. UI-Updates: Read-Side, `<CanonicalSlugRedirect>`, Helmet, Sitemap, BerufeShowcase.
4. Cron + UI-Card.
5. Memory + Doku.

## Akzeptanz

- Alle 191 active Produkte haben einen unique `canonical_slug`
- Aufruf eines Legacy-Slugs landet client-side auf canonical (Navigate replace)
- Sitemap enthält ausschließlich canonical
- `<link rel="canonical">` zeigt immer auf canonical
- Daily-Smoke 191/191 grün; <100% triggert Alert
- Recovery-Bridge bleibt funktional als Defense-in-Depth
