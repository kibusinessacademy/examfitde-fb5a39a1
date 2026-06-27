---
name: SEO Health OS 1
description: Deterministic SEO operator cockpit projecting customer-safe rate, dead-ends, bridge-ready links, orphans, canonical drift over existing SSOT views; no new tables/cron, read-only.
type: feature
---

# SEO.HEALTH.OS.1 — SEO Operator Cockpit

## Scope
Quick-Cut, Architecture-Freeze-konform. Keine neuen Tabellen, keine Trigger, kein Cron.
Pure SSOT-Projektor über bestehende SEO-Views.

## Inputs (read-only views)
- `v_package_seo_readiness_v1` — Pillar/Spoke/Blog Readiness pro Paket, customer_safe Flag
- `v_seo_bridge_candidates_v1` — interne Link-Kandidaten mit decision (READY/BLOCKED_*)
- `v_seo_orphan_analysis` — Orphan-Klassifizierung pro URL
- `v_seo_dead_end_coverage` — SEO-Dead-End-Pakete inkl. blocking_reason
- `v_seo_canonical_drift` — Canonical-URL Drift mit severity

## Action Queue Heuristik (priority × severity)
1. `CANONICAL_DRIFT` (P=100) — drift_severity CRITICAL/HIGH/MEDIUM → URL fix + Re-Render
2. `DEAD_END_PACKAGE` (P=90) — is_seo_dead_end=true → publishen oder Pillar reaktivieren
3. `READINESS_GAP` (P=85) — Lücken aus customer_safe/pillar/spoke/blog/link/intent
4. `ORPHAN_NO_INBOUND` (P=75) — Inbound-Bridges setzen
5. `BRIDGE_READY` (P=70) — Bulk-Link-Worker triggern (264 Stück live verfügbar)
6. `PILLAR_ORPHANED` (P=65)
7. `THIN_CONTENT_RISK` (P=55)
8. `BRIDGE_DUPLICATE` (P=40) — Dedupe
9. `ORPHAN_NO_OUTBOUND` (P=35)

Severity weights: critical=4, high=3, medium=2, low=1.
Score = priority * severity. Sort desc. Top 30.

## Suppression
Pakete in `dead_ends` werden aus `READINESS_GAP` ausgeschlossen → keine Doppelmeldungen.

## Surfaces
- Edge Function: `evaluate-seo-health` (admin-only, JWT-verified)
- Pure SSOT Module: `src/lib/seoHealth/` mirrored under `supabase/functions/_shared/seoHealth/`
- Admin UI: `/admin/governance/seo-health`
- Projector version: `seo-health-os-1.0.0`

## Verified Baseline (initial recon)
- 193 Pakete gesamt, **nur 2 customer_safe** (1.0%)
- 264 Bridge-Links **READY** to deploy
- 84 Bridge-Duplikate (dedupe-Kandidaten)
- 50 Orphans (12 no_inbound critical)
- 17 SEO-Dead-Ends
- 0 canonical drift (alle OK → keep monitoring)

## Tests
`src/__tests__/seo-health/projector.test.ts` — 12 deterministic tests covering totals,
priority ordering, suppression, threshold gates.
