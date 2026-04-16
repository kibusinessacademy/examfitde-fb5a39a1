---
name: release-classification-governance-v1
description: View v_package_release_classification ist SSOT für Publish-Guard; tägliche Snapshots in package_release_audit_snapshots mit Drift-Detection
type: feature
---

## Release-Klassifikations-Governance

`v_package_release_classification` ist die kanonische Wahrheitsquelle für Veröffentlichungsfähigkeit.

### Publish-Guard (`fn_guard_publish_requires_release_ok`)
- Trigger: `trg_guard_publish_requires_release_ok` BEFORE UPDATE OF status ON course_packages
- Blockiert NUR `release_block` (mit RAISE EXCEPTION + Audit)
- `release_warn` ist erlaubt (Policy `v_allow_warn=true`), wird aber auditiert
- Erfolgreicher Publish → `publish_guard_passed` in admin_actions
- Pakete ohne View-Eintrag → kein Block, aber `publish_guard_no_classification`

### Snapshot-System
- Tabelle: `package_release_audit_snapshots` (UNIQUE snapshot_date+package_id)
- RLS: nur Admins lesen
- Funktion: `fn_snapshot_release_classification()` — idempotent über UPSERT
- Cron: `snapshot-release-classification-daily` täglich 03:15 UTC
- Drift-Detection: vergleicht heute vs. gestern, schreibt `release_classification_drift_detected` bei Klassenwechsel

### Felder im Snapshot
package_id, course_title, track, package_status, release_class, deficiency_codes,
approved_questions, exam_relevant_questions, total_learning_fields, covered_learning_fields,
tutor_indices, oral_blueprints, handbook_chapters, minicheck_questions

### Verwendung
- Reconcile/Healer können `deficiency_codes` direkt in Requeue-Aktionen übersetzen
- Trendanalyse: `WHERE package_id=? ORDER BY snapshot_date`
- Regression-Alerts: `release_classification_drift_detected` in admin_actions abonnieren
