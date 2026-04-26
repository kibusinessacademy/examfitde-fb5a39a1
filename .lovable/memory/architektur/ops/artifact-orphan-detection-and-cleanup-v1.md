---
name: artifact-orphan-detection-and-cleanup-v1
description: View v_artifact_orphans (severity hard_orphan/backfillable), Cleanup-RPC mit Audit, Backfill-Chunk-Audit und stündlicher Cron-Sweep. Klassifier erkennt ops_guard_reason als Hint.
type: feature
---

## Orphan-Detection & Cleanup-Architektur

### Views
- `v_artifact_orphans(table_name, artifact_id, curriculum_id, package_id, reason, severity)`
  - Tabellen: minicheck_questions, exam_questions, exam_blueprints, oral_exam_blueprints, blueprint_targets, question_blueprints
  - severity: `hard_orphan` (curriculum/package_not_found, missing_curriculum_id) | `backfillable` (missing_package_id, curriculum noch da) | `inspect`
- `v_artifact_orphans_summary` — gruppiert nach (table_name, reason, severity); cluster_key='ARTIFACT_ORPHANS' für Cockpit.

### RPCs
- `admin_cleanup_artifact_orphans(p_table, p_max=500, p_dry_run=false)` — löscht **nur** `hard_orphan` und protokolliert in `artifact_orphan_cleanup_log`. Service-role only.
- `admin_minicheck_backfill_chunk(p_curriculum_id, p_package_id, p_limit)` — schreibt jeden Chunk in `backfill_chunk_audit` (Zeilen, Dauer, Trigger-Status, Fehler).

### Audit-Tabellen
- `artifact_orphan_cleanup_log` — jede gelöschte ID mit reason+payload+deleted_by.
- `backfill_chunk_audit` — pro RPC-Call: rows_updated, duration_ms, triggers_disabled[], triggers_restored, error_message.

### Cron
- `artifact-orphan-cleanup-hourly` (`23 * * * *`) — ruft den RPC mit max=500.

### Classifier-Fix
`fn_classify_unclassified_subcluster` erkennt jetzt `meta.ops_guard_reason` als Hint → liefert `OPS_GUARD_<UPPER(reason)>`. Damit fallen ~250 NON_BUILDING_PACKAGE Jobs nicht mehr in UNCLASSIFIED_EMPTY.

### Initial-Cleanup 2026-04-26
- 204 Zeilen aus `minicheck_questions` für nicht mehr existentes Curriculum `a0b0c0d0-0003-4000-8000-000000000001` gelöscht und in `artifact_orphan_cleanup_log` (deleted_by='migration_cleanup_2026_04_26') protokolliert.
- Verbleibende 1250 backfillable Zeilen (1031 question_blueprints, 219 oral_exam_blueprints) sind reguläre Backfill-Kandidaten — werden vom Sweep **nicht** gelöscht.
