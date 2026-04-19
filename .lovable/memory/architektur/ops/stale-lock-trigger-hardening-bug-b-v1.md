---
name: Stale-Lock-Trigger Hardening (Bug B Fix v1)
description: fn_guard_stale_lock_loop ignoriert ab 2026-04-19 Jobs mit started_at IS NULL (kein Recovery-Counter-Increment, kein HARD_KILL). NEVER_PICKED_UP wird stattdessen markiert. Fix gegen Multiplikator-Bug der 67+ Validate-Jobs unjustified failed gesetzt hat.
type: feature
---

## Bug B (root cause)
Der frühere Trigger zählte STALE_LOCK_RECOVERY-Zyklen unabhängig davon, ob ein Job jemals tatsächlich vom Worker geclaimed/gestartet wurde. Folge: Jobs die wegen Tick-Caps/Heavy-Budget nur deferred wurden, sammelten Recoveries, erreichten 5 Zyklen und wurden mit `STALE_LOCK_LOOP_HARD_KILL` terminiert → 67+ failed Validate-Jobs mit `started_at=NULL` und leerem last_error innerhalb von 24h.

## Härtung
- `IF NEW.started_at IS NULL THEN status='pending', last_error='NEVER_PICKED_UP'`
- Hard-Kill nur noch für Jobs mit echter Ausführungshistorie
- Forensik in `auto_heal_log` als `stale_lock_never_picked_up`

## Forensik-View
`v_ops_failed_no_start_jobs_24h` macht zukünftige Drifts sofort sichtbar.

## Coupling-Heal (Bug C Companion)
`admin_heal_step_job_coupling()` re-enqueued queued Steps ohne aktiven Job für: build_ai_tutor_index, validate_tutor_index, generate_oral_exam, validate_oral_exam, validate_learning_content, validate_exam_pool, generate_learning_content, finalize_learning_content.
