---
name: Pattern X13 — DAG Enqueue-Drift Loop (Council/Integrity)
description: Generischer Drift-Heal für `quality_council`/`run_integrity_check` ohne aktiven Job → fn_detect_and_heal_dag_enqueue_drift mit SSOT-konformem Payload (curriculum_id) und meta-JSON enqueue_source-Tag.
type: feature
---

# Pattern X13

**Symptom:** control-lane Worker-Stillstand (pending hoch, processing=0, completed_6h=0). Pakete haben `package_auto_publish` pending, dessen DAG-Dependency `quality_council` step ist `queued`/`failed` ABER ohne aktiven Job → klassischer Enqueue-Drift.

**Root-Cause:** Atomic-Trigger / X10-Cooldown / X12-Cooldown verhindern Re-Enqueue, aber kein Watcher hat sie nach Cooldown-Ende wieder eingehängt.

**Heal:** `fn_detect_and_heal_dag_enqueue_drift()`
- Resetet `failed`-Steps mit attempts<5 auf `queued`
- Enqueued fresh Jobs für ALL `queued`-Steps ohne aktiven Job
- Steps abgedeckt: quality_council, run_integrity_check, validate_lesson_minichecks, generate_learning_content, generate_exam_pool, auto_publish, finalize_learning_content
- Lane-Routing: integrity/minichecks → `recovery`, sonst → `control`

**Pflicht-Payload (SSOT-Trigger):** `package_id` + `curriculum_id` + `step_key`. `enqueue_source` ist KEINE Spalte in `job_queue` — Tag nur in `meta`-JSON ablegen.

**Audit:** auto_heal_log action_type='pattern_x13_council_drift_heal' mit result_status enqueued|skipped_dedup|error.

**Baseline 2026-05-02:** 48 control + 20 recovery Pakete in einem Lauf geheilt, control processing wieder >0.
