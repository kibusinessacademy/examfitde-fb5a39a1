---
name: Growth OS Phase 2H — Content Graph Health Guard
description: CI-Guard scripts/guards/content-graph-health-guard.mjs (warn-only) misst nodes/edges/orphans + Schwellwerte (orphan_rate>50%, missing_money_page>0, missing_funnel_next>20). Daily + PR. STRICT=1 opt-in.
type: feature
---

# Phase 2H — Content Graph Health Guard

## Script
`scripts/guards/content-graph-health-guard.mjs`
- Ruft `admin_get_content_graph_summary()` + `admin_get_content_graph_orphans()` via service-role.
- Berechnet `nodes_total`, `edges_total`, `orphan_count`, `missing_money_page`, `missing_funnel_next`, `orphan_rate`.
- Default warn-only (exit 0). Schwellwerte via Env überschreibbar (`TH_ORPHAN_RATE`, `TH_MISSING_MONEY_PAGE`, `TH_MISSING_FUNNEL_NEXT`).
- `STRICT=1` → exit 1 bei Breach.
- Keine DB-Writes.

## Workflow
`.github/workflows/content-graph-health-guard.yml`
- PR-Trigger (Migrationen, Script, Workflow) + daily 06:30 UTC + manual.
- Verwendet `SUPABASE_SERVICE_ROLE_KEY` Secret.

## Default-Schwellen
- `orphan_rate > 0.50` → warn
- `missing_money_page > 0` → warn
- `missing_funnel_next > 20` → warn

## Nicht-Ziele
- Kein Auto-Fix, kein Backfill, kein Edge-Write.
- Phase 3 (geplant): Keyword Registry ↔ Content Graph Sync (prüft, ob Nodes mit `keyword_slug` eindeutig in `growth_keyword_registry` owned sind).

## Rollback
```bash
rm scripts/guards/content-graph-health-guard.mjs
rm .github/workflows/content-graph-health-guard.yml
```
