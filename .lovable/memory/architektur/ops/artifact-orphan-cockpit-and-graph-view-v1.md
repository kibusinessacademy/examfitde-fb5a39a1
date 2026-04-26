---
name: artifact-orphan-cockpit-and-graph-view-v1
description: Cockpit-Karte ArtifactOrphansCard, RPCs admin_artifact_orphans_summary/_detail/_cleanup/_backfill_chunk_audit, Graph-View v_artifact_graph_consistency, UNCLASSIFIED_EMPTY Recalc
type: feature
---

## Cockpit & Graph-Konsistenz

### Frontend
- `src/components/admin/queue/ArtifactOrphansCard.tsx` — eigenständige Karte in QueuePage:
  - Summary-Tabelle (table_name × reason × severity)
  - Filter: severity (hard_orphan | backfillable | inspect) + table_name
  - Detail-Drilldown via `admin_artifact_orphans_detail` (max 200 Zeilen)
  - Dry-Run Button → `admin_cleanup_artifact_orphans(table, 500, true)` (zählt nur)
  - Sweep Button → `admin_cleanup_artifact_orphans(table, 500, false)` (löscht nur hard_orphan)
  - Backfill-Audit-Tabelle → `admin_backfill_chunk_audit(50)` (rows_updated, duration_ms, triggers_disabled, triggers_restored, error_message)
- Eingebunden in `src/pages/admin/v2/QueuePage.tsx` direkt nach `StuckJobTypeAlert`

### Backend RPCs (alle admin-gated via has_role)
- `admin_artifact_orphans_summary()` → cluster_key, table_name, reason, severity, counts
- `admin_artifact_orphans_detail(p_table, p_severity, p_limit)` → joined mit Graph-View
- `admin_backfill_chunk_audit(p_limit)` → backfill_chunk_audit DESC
- `admin_cleanup_artifact_orphans(p_table, p_max, p_dry_run)` → admin OR service_role; im Sweep-Modus löscht nur severity='hard_orphan'

### Graph-View `v_artifact_graph_consistency`
Pro Artefakt: curriculum_exists, package_exists, package_status, backfill_possible, suggested_package_id.
Damit zeigt der Drilldown nicht nur „orphan", sondern direkt die Ursache (curriculum fehlt, package fehlt, backfill möglich).

### Recalc 2026-04-26
250 Jobs mit `meta.ops_guard_reason` und leerem error/last_error_reason wurden umgeschrieben:
`meta.last_error_reason = meta.ops_guard_reason`. Damit fallen sie nicht mehr in UNCLASSIFIED_EMPTY,
sondern werden vom Cluster-Klassifier als reklassifizierbar erkannt.
