---
name: Heiler-Trio Hard-Fix (F1+F2+F3)
description: Coupling-Heiler v4 Enum-Drift ('completed'→entfernt) + ambiguous package_id behoben. Pipeline-Step-Drift v3 + Tail-Step-Drift v2 erhalten Phantom-Repair-Eligibility-Filter und Per-Row Try/Catch. fn_resolve_pending_enqueue_steps auf Drei-Phasen (Snapshot → Re-Read FOR UPDATE → Per-Row Boundary) — Trigger-Recursion killt nicht mehr den Batch.
type: feature
---

**Symptom 2026-05-03:** Pulse-Card "control Worker-Stillstand", aber Runner alive. Root: DAG-Prereq-Stall, weil 3 Heiler-Crons crashten.

**Crashes:**
- `coupling_heal_15min_v4` → `'completed'` ist kein step_status enum + ambiguous `package_id` (RETURN TABLE-Spalte vs. PL-Var).
- `tail-step-drift-v2` + `pipeline-step-drift-v3` → enqueueten `repair_exam_pool_quality` für Pakete mit `generate_exam_pool` already done → fn_guard_phantom_repair_enqueue blockt → ganzer Cron stirbt.
- `resolve-pending-enqueue-steps` → "tuple already modified by trigger", erster Konflikt killt ganzen Batch.

**Fix:**
- F1: Enum 'completed' raus, Vars vollqualifiziert (`jq.*`, `ps2.*`, `ps3.*`), zusätzlich PHANTOM_REPAIR_TARGET_DONE Skip.
- F2: WHERE-Filter `NOT (step='repair_exam_pool_quality' AND generate_exam_pool IN (done,skipped))` + `BEGIN/EXCEPTION` pro Row. Cooldown weiterhin via 30min auto_heal_log-Lookup.
- F3: Drei-Phasen wie `admin_heal_pending_enqueue_drift v1.5`: Snapshot → Re-Read mit `FOR UPDATE` → Per-Row `BEGIN/EXCEPTION`. Status-Wechsel durch Trigger ⇒ `skipped_already_progressed_by_trigger`. Per-Row-Errors landen als `resolve_pending_enqueue_per_row_error` in auto_heal_log.

**Verifikation 2026-05-03 14:30–14:35 UTC:**
- pipeline_step_drift_v3 → 61 rows succeeded (vorher: failed jeden Run).
- tail_step_drift_v2 → 5 rows succeeded.
- resolve_pending_enqueue → 16, dann 6 rows succeeded.
- coupling_heal_v4 erster Lauf nach Hotfix steht aus (Schedule */15).

**Folge:** Vorgänger-Steps `validate_blueprint_variants`/`generate_learning_content` werden wieder auf queued promoted, control + build können draignen.
