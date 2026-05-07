---
name: Growth Graph Audit Log Card Phase 2G
description: Read-only Audit-Log-Viewer für Growth-Graph-Aktionen. RPC admin_get_growth_graph_audit_log filtert auto_heal_log auf 5 action_types (backfill, apply_edges real+dry_run, node_register, edge_link). UI mit Badge dry/real, inserted/skipped/errors, expandable result_detail+metadata.
type: feature
---

# Phase 2G: Audit Log Viewer

## RPC
`admin_get_growth_graph_audit_log(p_limit int DEFAULT 50)` — SECURITY DEFINER + has_role admin gate. Liest auto_heal_log gefiltert auf:
- growth_content_graph_backfill
- growth_content_graph_apply_edges
- growth_content_graph_apply_edges_dry_run
- growth_content_node_register
- growth_content_edge_link

REVOKE PUBLIC/anon, GRANT authenticated/service_role. Limit clamped 1..200.

## UI
`GrowthGraphAuditLogCard` (in GrowthGraphLeitstelleCard nach Edge-Plan):
- Letzte 25 Aktionen
- Badge dry-run (info) / real (petrol) / sonst nichts
- Status-Badge success/warning/danger/muted
- inserted/skipped/errors aus result_detail (Fallback would_insert/would_skip_existing)
- Reason aus metadata.reason
- Expandable Row mit JSON-Pretty result_detail + metadata
- Refresh-Button, kein Cron, keine Mutationen

## Constraints
- Read-only RPC, kein Write
- staleTime 30s, kein refetchInterval
