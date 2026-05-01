---
name: Heal v3 Big Bang
description: Top-3-Cluster Noise-Killer + SHADOW Auto-Heal + 3-Stufen-Exam-Pool-Fallback + adaptive AI-Heal-Plans + Patch 1+2 (job_type-Fix, target_type-Fix, Loop-Counter in meta, Quarantäne-View, Stagnation-Alerting, Live-Regressionstests)
type: feature
---

## Patch 2 (final state)

### Exam-Pool Fallback (`fn_exam_pool_fallback_progress`)
Zählt + cancelt **alle 5 echten** job_types:
`package_generate_exam_pool`, `package_repair_exam_pool_quality`, `package_validate_exam_pool`,
`package_repair_exam_pool_competency_coverage`, `package_repair_exam_pool_lf_coverage`.
3 Stufen: provider_switch (3) → constraint_relax (5) → paused (8).
Bei `paused`: alle aktiven Jobs cancelled + Backlog-Task in `heal_permanent_fix_tasks` (pattern_key='exam_pool_paused', priority='critical').

### Loop-Counter (DAG-Guard)
`package_steps.meta.dag_block_counters[signature]` zählt jeden geblockten INSERT (unabhängig vom Log-Dedup). Schwelle 50 → step blocked. Log-Inserts dedupt auf 1×/5min.

### Stagnation-Alert
Cron `exam-pool-stagnation-alert-15min` (jobid 140, */15) ruft `fn_exam_pool_stagnation_alert`:
- Fail-Burst: ≥5 fails/1h → critical Backlog-Task
- Stagnation: aktive Jobs >30min ohne Update → critical Backlog-Task
Dedup: skip wenn open critical-Task in 1h existiert.

### Admin-Quarantäne
View `v_admin_exam_pool_paused` listet alle paused/relax/switch Pakete + active_jobs + cancelled_jobs_6h + open_backlog_task_id.
3 Admin-RPCs (alle has_role('admin')-gated, mit auto_heal_log Audit):
- `admin_exam_pool_restart(uuid)` — Reset state→normal, schließt offene Tasks
- `admin_exam_pool_cancel_all(uuid)` — Cancel alle aktiven Jobs
- `admin_exam_pool_quarantine(uuid, text)` — Force paused + cancel + critical Task

UI: `ExamPoolQuarantineCard` in HealCockpitPage Sektion 3 (nach CourseHealPlansCard).

### Live-Regressionstests
`admin_test_heal_v3_invariants()` prüft 5 Invariants gegen DB:
1. `dag_guard_block` mit `target_type='job'` (post-2026-05-01 07:00 UTC) = 0
2. `package_steps` mit `dag_block_counters` in meta (>0 = aktiv)
3. paused Pakete mit aktiven exam_pool-Jobs = 0
4. Beide Heal-Plan-Trigger existieren (= 2)
5. `fn_get_active_heal_plan` hat 0 grants für `authenticated`
Button im ExamPoolQuarantineCard: "Heal v3 Invariants prüfen".

### Security
- `fn_get_active_heal_plan` nur `service_role`
- `admin_get_active_heal_plan` Wrapper für UI mit has_role-Check
- Alle Admin-RPCs raise 42501 ohne admin-role

## Datenbank-Spalten (wichtig, schema-drift-fest)
`exam_pool_fallback_state`: package_id, fail_count_6h, current_stage, last_fail_at, last_stage_change_at, model_override, constraint_overrides, paused_reason, created_at, updated_at.
`heal_permanent_fix_tasks`: pattern_key, cluster, package_id, title, description, status, priority, created_by, … (NICHT permanent_fix_backlog).
