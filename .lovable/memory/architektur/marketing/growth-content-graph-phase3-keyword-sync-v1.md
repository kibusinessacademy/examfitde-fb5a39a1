---
name: Growth OS Phase 3 — Keyword Registry ↔ Content Graph Sync
description: admin_check_keyword_graph_sync() RPC (read-only, admin-only) + warn-only Guard scripts/guards/keyword-graph-sync-guard.mjs. Metriken missing_keyword_registry/keyword_owner_mismatch/duplicate_active_keyword_owner. Daily 06:40 UTC + PR. Kein Auto-Fix.
type: feature
---

# Phase 3 — Keyword Registry ↔ Content Graph Sync

## RPC
`admin_check_keyword_graph_sync()` — STABLE, SECURITY DEFINER, has_role('admin') gate.
Returns `{metrics, samples, computed_at}`.

Metrics:
- `nodes_with_keyword_slug`
- `keywords_registered` (active)
- `missing_keyword_registry` — Node hat keyword_slug, aber kein active registry-Eintrag
- `keyword_owner_mismatch` — registry.owner_id ≠ node.id
- `duplicate_active_keyword_owner` — sollte 0 sein (unique idx), Sicherheitsnetz
- `ok_count`

Samples: top 10 pro Drift-Kategorie (missing_registry, owner_mismatch, duplicate_active).

## Guard
`scripts/guards/keyword-graph-sync-guard.mjs` (warn-only, exit 0).
Schwellen via Env (`TH_MISSING_KEYWORD_REGISTRY`, `TH_KEYWORD_OWNER_MISMATCH`, `TH_DUPLICATE_ACTIVE_KEYWORD_OWNER`, default 0). `STRICT=1` → exit 1.

## Workflow
`.github/workflows/keyword-graph-sync-guard.yml` — PR (Migration/Script/Workflow) + daily 06:40 UTC + manual.

## Nicht-Ziele
- Kein Auto-Register, kein Owner-Heal.
- Kein UI in diesem PR — kommt nach PR-Comment + Metrics-Artifact, sobald Metriken stabil.

## Rollback
```sql
DROP FUNCTION public.admin_check_keyword_graph_sync();
```
```bash
rm scripts/guards/keyword-graph-sync-guard.mjs
rm .github/workflows/keyword-graph-sync-guard.yml
```
