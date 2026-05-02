---
name: Control-Lane DAG-Drift Watchdog v1.1
description: 10-min cron healt Control-Lane-Stillstand bei DAG-Vorgänger-Hängern (quality_council). v1.1 Schema/Logik-Fix: target_id::text, metadata-Spalte, Skip nur bei frischer Aktivität (updated_at<10min), korrekte Cron-Schedule.
type: feature
---

**Symptom:** control-Lane processing=0, completed_6h=0, pending wächst (74× package_auto_publish + 1× package_finalize_learning_content), während recovery+build laufen.

**Root-Cause:** `claim_pending_jobs_by_types` filtert über DAG-Prereqs. Wenn der Vorgänger-Step (`quality_council`) in `queued`/`failed`/`pending_enqueue` hängt, wird der control-Job nie claimed.

**Fix v1 (strukturell):**
- `v_control_lane_dag_drift` + `admin_get_control_lane_drift()`: forensische Sicht.
- `fn_heal_control_lane_dag_drift()` (cron `*/10 * * * *`): verkettet `admin_heal_failed_quality_councils` + `admin_heal_pending_enqueue_drift` + `admin_nudge_atomic_trigger`.
- `admin_heal_control_lane_drift()`: manueller Trigger.

**Fix v1.1 (2026-05-02) — 3 latente Bugs:**
1. **target_id-Typ-Mismatch:** `auto_heal_log.target_id` ist `text`, nicht `uuid` → INSERT auf `nudge_failed`-Branch warf Exception, Loop wurde abgebrochen. Fix: `v_pkg::text`.
2. **Stale-Processing-Skip-Falle:** Skip-Bedingung `processing>0` blockierte Heal dauerhaft, wenn ein einzelner stale Job hing. Fix: Skip nur bei `processing AND updated_at > now()-10min`. Stale processing wird geloggt (`control_lane_drift_stale_processing_detected`) aber heilt weiter.
3. **Cron-Schedule:** `*/10 * * * *` per `cron.schedule` idempotent re-attached (unschedule+reschedule).

**Trigger-Audit-Befund v1:** `fn_cancel_orphan_jobs_on_step_done` war als Trigger-Funktion definiert, aber an keiner Tabelle attached → entfernt.

**Validierung v1.1:** Manueller Run nudged 50 queued QCs ohne Exceptions, target_id sauber als text geschrieben. Folge-TODO: `admin_heal_failed_quality_councils` und `admin_heal_pending_enqueue_drift` werfen Exceptions (returnen -1) — separate Forensik-Stufe.
