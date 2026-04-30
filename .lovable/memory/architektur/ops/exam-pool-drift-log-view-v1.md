---
name: Exam-Pool Drift-Log View
description: v_admin_exam_pool_drift_log (7-Tage Lauf-Log) + get_exam_pool_drift_log_for_package(uuid) Drilldown-RPC. Quelle ist auto_heal_log action_type='exam_pool_drift_detection'.
type: feature
---

# Exam-Pool Drift-Log Einsicht

## View: v_admin_exam_pool_drift_log
- Quelle: auto_heal_log WHERE action_type='exam_pool_drift_detection' AND created_at > NOW()-7d
- Eine Zeile pro Cron-Lauf (alle 15min)
- Spalten: run_id, run_at, result_status (success/noop/error), total_candidates, healed, nudged, skipped, cooldown_skips, update_failed, already_done_or_running, dry_run, candidates_json, nudged_ids, healed_ids, skip_details_json, duration_ms
- GRANT SELECT TO authenticated

## RPC: get_exam_pool_drift_log_for_package(p_package_id uuid)
- SECURITY DEFINER, GRANT EXECUTE TO authenticated (REVOKE FROM anon)
- Liefert pro Drift-Lauf der letzten 7 Tage: was_candidate, was_nudged, was_healed, was_skipped, skip_reason, approved_q, in_cooldown, step_status
- Filter via JSONB-Containment: candidates @> [{"package_id":"..."}]

## Verifiziert
- Letzte Läufe sichtbar: cron alle 15min, KPI-Counts korrekt aggregiert
- Pre-existing Linter-Findings nicht durch Migration verursacht
