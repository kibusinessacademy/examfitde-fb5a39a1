---
name: P6 Cut 3 — Crawl-State SSOT route_crawl_policy
description: Central DB-SSOT for index/noindex/redirect/gone — sitemap, RouteNoindex, AppRoutes redirects validate against this single table.
type: feature
---

# P6 Cut 3 — Crawl-State SSOT

## Problem
Drei parallele Wahrheiten für Crawl-State (RouteNoindex Patterns, AppRoutes
`<Navigate>`-Redirects, hardcoded sitemap-static Liste). Drift zwischen ihnen
erzeugt GSC 404/Soft-404/Indexed-but-noindex Cluster.

## SSOT
- **Tabelle** `public.route_crawl_policy(pattern, match_type, state, redirect_to, reason, source, priority, changefreq)`
- **Enum** `route_crawl_state ∈ {index, noindex, redirect, gone}`
- **match_type** `∈ {exact, prefix, regex}`
- **CHECK** `state='redirect' → redirect_to NOT NULL`
- **UNIQUE** `(pattern, match_type)`
- **RLS** ENABLED, REVOKE all from anon/authenticated, GRANT only to service_role.
  Kein Direkt-SELECT für Clients — Zugriff ausschließlich über RPC.

## RPCs
- `public_get_indexable_routes()` — STABLE SECURITY DEFINER, anon-callable.
  Liefert nur `state='index' AND match_type='exact'` → Sitemap-Pfad.
- `admin_get_route_crawl_policy()` — STABLE SECURITY DEFINER mit
  `has_role(auth.uid(),'admin')` Gate. Liefert die volle Tabelle für das
  zukünftige GSC/SEO-Cockpit.

## Sitemap-Switch
`supabase/functions/generate-sitemap/index.ts` liest im `static`-Branch
direkt aus `route_crawl_policy` (service_role Client, kein RPC-Roundtrip
nötig). Fallback auf 7 Hardcoded-Routen, falls Query failt — DB-Outage
Resilience.

## Seed (P6 Cut 3 initial, 2026-05-21)
- **42 noindex** prefixes (mirror NOINDEX_PATTERNS): /auth, /app, /admin,
  /checkout, /exam-trainer, /lesson, /quiz/, /lernplan/, /legal, /products,
  /product/, /category, /search, /learning, /tools/, …
- **18 redirect** rules (mirror AppRoutes.tsx): /about→/unternehmen,
  /products→/paket, /legal/*→/agb, /learning/*→/dashboard,
  /payment-success→/purchase-success, /sitemap→/sitemap.xml, …
- **43 index** exact routes (mirror sitemap-static): /, /themen, /berufe,
  /paket, /shop, /wissen, /blog, /pruefungstraining/*, /aevo-*,
  /bilanzbuchhalter-*, /fiae-*, /ihk-*, …

## Audit
`fn_emit_audit('route_crawl_policy_seeded', ...)` mit required_keys
`{source, count}`. Contract registriert in `ops_audit_contract`.

## Contract-Tests
`src/__tests__/route-crawl-policy.contract.test.ts`:
1. Min-Counts pro state (40/15/40)
2. Jeder NOINDEX_PATTERNS prefix hat eine noindex-Zeile
3. Jeder `<Navigate to>`-Redirect hat eine redirect-Zeile
4. Mutex: kein (pattern, match_type) gleichzeitig in zwei states

## Anti-patterns
- ❌ Direct SELECT auf `route_crawl_policy` aus Client/Edge-Function ohne
  service_role.
- ❌ Neuen `<Navigate>` in AppRoutes ohne Seed-Eintrag (Tests failed).
- ❌ Neuen Eintrag in NOINDEX_PATTERNS ohne Seed-Eintrag (Tests failed).
- ❌ Hardcoded URL-Liste in Sitemap-Branch (außer Outage-Fallback).

## Nächste Cuts
- Phase 2: Hard Guard via Trigger blockiert INSERT mit konfliktierendem
  state für identical (pattern, match_type).
- Phase 3 (post-Vercel-Cutover): Prerender liest Policy für
  per-route X-Robots-Tag Generierung.
- Admin-UI Card im Growth-Tab konsumiert `admin_get_route_crawl_policy`
  für GSC-Reconciliation-Workflow.
