---
name: BerufOS Intelligence Graph Foundation v1
description: 5-layer unified graph (Skill/Competency/Workflow/Outcome/Recovery) extending berufs_ki_graph_* SSOT — no parallel system. Evidence-gated edges, deterministic rebuild, snapshots, audit contracts.
type: feature
---

# BerufOS Intelligence Graph Foundation v1

**Architectural decision:** EXTEND the existing `berufs_ki_graph_nodes`/`berufs_ki_graph_edges` (per Architectural Continuity Guard: NO_PARALLEL_SYSTEMS, EXTEND_EXISTING, BRIDGE_DONT_FORK). No new `graph_nodes`/`graph_edges` tables.

## 5 logical layers (one physical graph)
- **Skill** — praktisches Können (`node_type='skill'`)
- **Competency** — prüfungs-/curriculumrelevant (`node_type='competency'`, source `competencies`)
- **Workflow** — berufliche Arbeitsabläufe (`node_type='workflow'`, source workflow_definitions)
- **Outcome** — messbare Wirkung (`node_type='outcome'`)
- **Recovery** — Maßnahmen gegen Schwächen (`node_type='recovery_action'`)

Zusätzlich: `lesson`, `certification`, `curriculum`, plus bestehende (`blueprint`, `profession`, `role`, `kpi`, …).

## Edge-Semantik (erweitert)
`requires`, `supports`, `trains`, `assesses`, `improves`, `recovers`, `produces`, `belongs_to`, `derived_from`, `maps_to`, `prerequisite_of`, `weakens`, `strengthens`, `part_of`, `extends`, `conflicts_with`, `causes`, `commonly_used_with`, `related_to`.

## Lifecycle (neu)
- `berufs_ki_graph_nodes.status` ENUM `draft|active|deprecated|archived` (default `active`)
- `berufs_ki_graph_edges.status` ENUM `proposed|active|rejected|deprecated` (default `active`)
- Deterministische Builder schreiben direkt `active`; AI-Vorschläge MÜSSEN `proposed` schreiben.

## Evidence-Pflicht
`berufs_ki_graph_evidence` (edge_id, evidence_type, source_table, source_id, confidence, metadata).
`admin_activate_proposed_edge` blockt mit `edge_has_no_evidence`, wenn keine Evidence existiert.

## Snapshots
`berufs_ki_graph_snapshots` (graph_scope, node_count, edge_count, **checksum** md5 über node-ids + edge-tripel, meta jsonb). Stabile checksum bei idempotentem Rebuild = Drift-Detektor.

## RPCs (alle SECURITY DEFINER + has_role-Gate)
- `admin_get_berufos_graph_summary()` — totals + by_type + by_status + orphan/proposed/evidence counts + latest snapshot
- `admin_get_berufos_graph_drift_report()` — edges_without_evidence, orphan_active_nodes, proposed_stale_7d, deprecated_with_active_edges, low_confidence_active_edges
- `admin_get_berufos_graph_node_detail(p_node_id)` — node + incoming/outgoing edges
- `admin_rebuild_berufos_graph(p_scope, p_dry_run)` — idempotent, bridged Curricula → curriculum-Nodes, Certifications → cert-Nodes, Competencies → competency-Nodes, `competency belongs_to curriculum` Edges mit auto-Evidence; bei `p_dry_run=false` Snapshot
- `admin_activate_proposed_edge(p_edge_id, p_reason)` — evidence-gated
- `admin_reject_proposed_edge(p_edge_id, p_reason)`
- `learner_get_skill_path()` — auth-scoped skill listing
- `manager_get_competency_risk_graph()` — manager/admin/owner-gated competency-degree map

## Audit-Contracts (7)
`berufos_graph_rebuild_started`, `berufos_graph_rebuild_completed`, `berufos_graph_drift_detected`, `berufos_graph_edge_proposed`, `berufos_graph_edge_activated`, `berufos_graph_edge_rejected`, `berufos_graph_integrity_failed` — registriert in `ops_audit_contract` (required_keys text[], owner_module='berufos_graph').

## Views (admin-only, REVOKE'd)
- `v_bki_graph_orphan_nodes` — active nodes ohne Edges
- `v_bki_graph_proposed_edges` — Review-Queue mit from/to titles + evidence_count

## UI
- `/admin/berufos-graph` → `BerufOSGraphPage`
  - Summary-Card (totals, evidence)
  - Nodes-by-Type / Edges-by-Type Badge-Cluster
  - Drift-Card (5 KPIs)
  - Snapshot-Card (Checksum-Hash + Zeitstempel)
  - Dry-Run + Rebuild Buttons (mit Inserted-Counts pro Bridge)
- Hook: `useBerufOSGraph` (summary, drift, rebuild, activate/reject)

## Strategischer Anker (BerufOS-Vision)
Dieser Graph IST der "technische Graben" der Plattform: Skill/Competency/Workflow/Outcome/Recovery auf EINER Architektur. Nächster Cut: **Graph Activation Layer** — Empfehlungen, Tutor-Kontext, Prüfungslogik, Manager-Interventionen ziehen direkt aus diesem Graph.
