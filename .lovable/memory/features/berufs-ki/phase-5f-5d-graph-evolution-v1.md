---
name: Phase 5F + 5D Knowledge Graph & Evolution Engine
description: Berufs-KI Knowledge Graph (nodes/edges) + Workflow Evolution Engine
type: feature
---

## Phase 5F — Knowledge Graph
- Tabellen: `berufs_ki_graph_nodes` (15 node_types), `berufs_ki_graph_edges` (12 edge_types).
- Auto-Sync: Trigger `trg_bki_sync_workflow_node` spiegelt jedes Workflow als Node.
- RLS: read=authenticated, write=admin only.
- Admin-RPCs: `admin_bki_graph_summary`, `admin_bki_create_node/_edge`, `admin_bki_delete_edge`, `admin_bki_neighborhood` (depth ≤3, recursive CTE).
- UI: `/admin/berufs-ki/graph` — Summary-KPIs, Top-Hubs, Knoten-Browser, Nachbarschaft, Create-Node + Create-Edge.

## Phase 5D — Evolution Engine
- Tabelle: `berufs_ki_evolution_candidates` (admin-only RLS).
- Detection-RPC `admin_bki_evolution_detect`: aktuell 1 Pattern (`high_quality_promotion`: avg quality≥4 + ≥3 runs → blueprint candidate).
- Governance: `admin_bki_evolution_decide(approve|reject|review)` setzt status + reviewed_by/at.
- UI: `/admin/berufs-ki/evolution` — Filter, Detect-Trigger, Approve/Reject/Review per Karte.

## Phase 5G — Analytics (vorbereitet)
- View `v_bki_graph_summary` (service_role only) liefert Totals + Pending Evolution.
- `nodes_by_type` / `edges_by_type` / `top_hubs` direkt im Summary-RPC.

## Nächste Schritte
- Mehr Detection-Pattern (Workflow-Chains, fehlende Inputs, Governance-Risk).
- Auto-Edge-Suggestion via AI (workflow → competency).
- Graph-Visualisierung (force-layout) statt Liste.
