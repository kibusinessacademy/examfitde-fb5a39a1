---
name: Phase 2F-Hardening Dry-Run + Selection Summary
description: admin_apply_content_graph_edges um p_dry_run erweitert; UI gating Dry-Run→Real Apply, Selection Summary, Error-Details
type: feature
---
# Phase 2F-Hardening · Safe Dry-Run Edge Apply

## RPC
`admin_apply_content_graph_edges(p_edges jsonb, p_reason text, p_dry_run boolean DEFAULT true)`
- Dry-Run: identische Validierung, keine Inserts. Rückgabe: `would_insert`, `would_skip_existing`, `errors`.
- Real-Run: bestehendes Verhalten (`inserted`, `skipped`).
- Audit-Log: `growth_content_graph_apply_edges_dry_run` vs `growth_content_graph_apply_edges`. Metadata enthält `dry_run`-Flag, actor, reason.
- 2-arg Overload entfernt (nur 3-arg-Variante existiert, default dry_run=true).

## UI (`GrowthGraphEdgePlanCard`)
- Card-Button = "Dry-Run (N)" — kein direkter Real-Apply mehr.
- Confirm-Dialog enthält:
  - **Selection Summary**: total, money_page, funnel_next, distinct sources, distinct targets.
  - Reason-Textarea (≥3 Zeichen).
  - Buttons: Abbrechen / Dry-Run / Real Apply.
- **Real-Apply ist disabled bis erfolgreicher Dry-Run für die aktuelle Auswahl**. Selection-Signature-Hash invalidiert bei Änderung („bitte erneut Dry-Run").
- Dry-Run-Result-Block: would_insert/would_skip/errors + collapsible Error-Details.
- Nach Real-Apply: Toast + Last-Result-Banner (inserted/skipped/errors), Reset, invalidate ['growth-graph-edge-plan','growth-graph-summary','growth-graph-orphans'].
- Medium/Low bleiben Checkbox-disabled. Kein Auto-Apply, kein Cron.
