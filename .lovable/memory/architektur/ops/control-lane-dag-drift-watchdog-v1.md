---
name: Control-Lane DAG-Drift Watchdog v1
description: 10-min cron healt Control-Lane-Stillstand, wenn auto_publish/finalize blockiert sind weil DAG-Vorgänger (quality_council) queued/failed/pending_enqueue hängt
type: feature
---

**Symptom:** control-Lane processing=0, completed_6h=0, pending wächst (74× package_auto_publish + 1× package_finalize_learning_content), während recovery+build laufen.

**Root-Cause:** `claim_pending_jobs_by_types` filtert über DAG-Prereqs. Wenn der Vorgänger-Step (`quality_council`) in `queued`/`failed`/`pending_enqueue` hängt, wird der control-Job nie claimed. Lane-Health-Card zeigt das als "DAG-Backlog" (processing>0) bzw. "Worker-Stillstand" (processing=0).

**Fix (strukturell, idempotent):**
- `v_control_lane_dag_drift` + `admin_get_control_lane_drift()`: forensische Sicht auf alle blockierten control-Jobs mit Blocker-Step + Status.
- `fn_heal_control_lane_dag_drift()` (cron `*/10 * * * *`): verkettet `admin_heal_failed_quality_councils` (failed) + `admin_heal_pending_enqueue_drift` (pending_enqueue) + `admin_nudge_atomic_trigger` (queued ohne Job). Skippt wenn Lane bereits processing>0. Audit in `auto_heal_log` (`control_lane_drift_heal|skipped|nudge_failed`).
- `admin_heal_control_lane_drift()`: manueller Trigger aus UI (has_role-Gate).

**Trigger-Audit-Befund:** `fn_cancel_orphan_jobs_on_step_done` war als Trigger-Funktion definiert, aber an keiner Tabelle attached → entfernt. Alle anderen `job_queue`-Trigger sauber attached (22 Stück).

**Validierung (initial heal, 50 Pakete genudged):** qc_pending 0→21, qc_processing 0→10, recovery-Lane verarbeitet jetzt die Backlog-Welle. Sobald `quality_council` done, wird auto_publish DAG-frei.
