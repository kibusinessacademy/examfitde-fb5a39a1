---
name: Phase 2E UI · Edge Plan Card
description: GrowthGraphEdgePlanCard zeigt admin_preview_content_graph_edge_plan read-only in der Leitstelle
type: feature
---
# Phase 2E UI · Edge Plan Card

## UI
- `GrowthGraphEdgePlanCard` (in `GrowthGraphLeitstelleCard` integriert, unter Backfill-Control).
- Datenquelle: `admin_preview_content_graph_edge_plan(p_limit_per_node=3, p_max_nodes=100)`.
- 6 Stat-Tiles: missing money_page, missing funnel_next, proposals total/high/medium/low.
- Hinweisband (Read-only, Apply folgt in 2F).
- Top-25 Vorschläge flach sortiert nach Confidence (high→medium→low) und edge_type, mit From/To/Type/Confidence-Badge/Reason.
- Manual Refresh, Skeleton, Error-Retry, kein Apply-Button.

## Constraints
- Nur Read.
- Apply-Button bewusst ausgespart — Phase 2F: nur selected high-confidence, max 25/Run, Confirm-Dialog, auto_heal_log Audit, idempotent über unique edge constraint, anschließend Refetch von orphans + edge-plan.
