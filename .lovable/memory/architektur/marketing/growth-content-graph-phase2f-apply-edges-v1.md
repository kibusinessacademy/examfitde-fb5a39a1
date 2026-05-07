---
name: Phase 2F Content Graph Apply Selected Edges
description: admin_apply_content_graph_edges schreibt nur selected high-confidence Edges (max 25/Run, idempotent, audited)
type: feature
---
# Phase 2F · Apply Selected High-Confidence Edges

## RPC
`admin_apply_content_graph_edges(p_edges jsonb, p_reason text) RETURNS jsonb`
- SECURITY DEFINER, search_path=public, REVOKE PUBLIC/anon, GRANT authenticated/service_role.
- has_role('admin') gate.
- Reason Pflicht (>=3 chars).
- Max 25 Edges/Run.
- Akzeptiert nur edge_type ∈ {money_page, funnel_next}.
- Validiert: from/to existieren in growth_content_graph_nodes, keine self-loops.
- Idempotent via UNIQUE (from_node_id, to_node_id, edge_type) → ON CONFLICT DO NOTHING (skipped_exists).
- Per-Edge try/catch: Fehler werden gesammelt (errors[]), Run nicht abgebrochen.
- Schreibt auto_heal_log action_type='growth_content_graph_apply_edges' mit inserted/skipped/errors + reason + actor.
- Rückgabe: { requested, inserted, skipped, errors_count, errors, results, reason, applied_at }.

## RPC-Patch (Edge Plan)
`admin_preview_content_graph_edge_plan` exposed jetzt `to_node_id` UUID je proposal — Voraussetzung für Apply.

## UI
`GrowthGraphEdgePlanCard` Phase 2F:
- Checkbox je Vorschlag — **nur high-confidence aktivierbar**, medium/low disabled.
- "Alle high (N)" Toggle, Cap auf 25.
- Apply-Button → Confirm-Dialog mit Reason-Pflichtfeld (Textarea, min 3 Zeichen).
- Pending: alle interaktiven Elemente disabled.
- Nach Erfolg: Toast (inserted/skipped/errors), invalidate ['growth-graph-edge-plan','growth-graph-summary','growth-graph-orphans'].
- Kein "Apply all", kein medium/low Apply, kein Backfill.
