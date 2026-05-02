---
name: Cancel-Loop Patterns X9/X10/X11
description: Quality-Council MAX_ATTEMPTS-Loop, Phantom-Atomic Race-Condition, Drift-Detector Mass-Cancel-Burst — alle drei systemisch mit Pre-Insert-Guards + Cooldown-Helper geheilt
type: feature
---

## Symptom (Forensik 6h-Window 2026-05-02)
- 644 cancelled `package_quality_council` (MAX_ATTEMPTS_EXHAUSTED), 0 completed
- 397 cancelled `package_run_integrity_check` (OBSOLETE_TAIL_BLOCK_v4)
- 34 cancelled `package_generate_exam_pool/run_integrity_check` (STEP_ALREADY_DONE_PHANTOM)
- 8 Pakete mit `quality_council` Step `done` aber laufenden Loop-Jobs

## Pattern X9 — Quality-Council Coupling-Recovery-Loop
**Root Cause**: `admin_heal_step_job_coupling_v3/v4` (cron */15) enqueuet `package_quality_council` für Pakete deren Step bereits `done` oder `failed` ist. Worker dispatcht → `MAX_ATTEMPTS_EXHAUSTED: attempts=9 max=8` → cancel → re-enqueue im nächsten Cron-Tick.

**Fix**:
- Bulk-Cancel aller pending/failed quality_council jobs für `step IN (done,skipped)` (33 cancelled).
- Step-Reset `failed → queued` für 12 Pakete damit DAG sauber neu greift.
- Audit `pattern_x9_quality_council_phantom_heal`, `pattern_x9_step_reset`.

## Pattern X10 — Phantom-Atomic Race trotz X7-Fix
**Root Cause**: `fn_atomic_enqueue_on_step_queued` greift bei INSERT auf `queued`. Wenn Worker zwischen Insert und Trigger-Execution den Step auf `done` setzt (Race-Window ~ms), wird trotzdem ein Job enqueued der sofort als `STEP_ALREADY_DONE_PHANTOM` cancelt.

**Fix**: Pre-Insert-Guard im Trigger:
```sql
SELECT COUNT(*) FROM auto_heal_log
WHERE action_type IN ('step_finalized_done','step_finalized_skipped')
  AND target_id = NEW.id::text
  AND created_at > now() - interval '5 minutes';
```
Wenn >0 → Audit `pattern_x10_phantom_atomic_blocked` + RETURN ohne Insert.

## Pattern X11 — Drift-Detector Mass-Cancel-Burst
**Root Cause**: drift-detector cancelt `package_run_integrity_check`/`quality_council`/`auto_publish` mit `OBSOLETE_TAIL_BLOCK_v4`. Atomic-Trigger enqueuet sofort wieder. Loop bis Cron-Reaper greift.

**Fix**:
- Bulk-Cancel pending tail-jobs für Pakete mit ≥10 OBSOLETE_TAIL_BLOCK in 1h.
- Helper `fn_drift_cancel_cooldown_check(pkg, job_type)` returnt `false` wenn ≥5 OBSOLETE_TAIL_BLOCK in 30min — Drift-Detector MUSS das prüfen vor Cancel.

## Operational Notes
- Drift-Detector-Edge-Function muss `fn_drift_cancel_cooldown_check` aufrufen vor Cancel-Insert. Code-Anpassung empfohlen aber DB-Schicht ist self-defending.
- Memory-relevante Cluster für Heal-Pattern-Detection: `pattern_x9_*`, `pattern_x10_*`, `pattern_x11_*`.
- Max-Attempts wirkt pro Job-Row; counter wird vom Runner pro Lease inkrementiert. Job mit `attempts=9 max=8` deutet auf Re-Insert mit identical lease-token bug oder per_type_cap-Verzerrung. v4-Cron ist sauber, der Insert kommt vom Atomic-Trigger.
