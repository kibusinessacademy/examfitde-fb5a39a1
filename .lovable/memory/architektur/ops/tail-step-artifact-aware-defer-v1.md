---
name: Tail-Step Artifact-Aware Defer
description: Pakete mit approved questions werden bei No-Progress nicht hart geblockt; Tail-Step-Jobs werden auf retry_scheduled deferred statt cancelled
type: feature
---

# Tail-Step Artifact-Aware Defer (Root-Fix für building→blocked Loop)

## Problem
Pakete mit vollständigen Artefakten (approved questions > 0) wurden vom No-Progress-Guard
hart auf `blocked` gesetzt und ihre Tail-Step-Jobs gecancelt → manuelle Heilung nötig.

## Fix (Defense in Depth, Option B)

### 1) `fn_record_integrity_run_and_check_progress` (RPC)
Wenn Score-Range < min_improvement:
- Prüft `package_has_approved_artifacts()` UND offenen Tail-Step
  (`repair_exam_pool_quality`, `run_integrity_check`, `quality_council`, `auto_publish`)
- Wenn beides true → SKIP Block + SKIP Cancel
- Audit: `auto_heal_log.action_type='tail_step_retryable_deferred'` mit
  `metadata.defer_reason='TAIL_STEP_RETRYABLE_WITH_ARTIFACTS'`
- Return: `{no_progress_block: false, reason: 'tail_step_retryable_with_artifacts'}`

### 2) `fn_auto_cancel_jobs_on_package_exit` (Trigger)
Beim Übergang `building → blocked/...`:
- Wenn `package_has_approved_artifacts()` → Tail-Step-Jobs (via `is_tail_step_job_type()`)
  werden auf `status='retry_scheduled', scheduled_for=now()+30min` gesetzt statt cancelled
- Audit in `auto_heal_log` + `system_heal_log`
- Non-Tail-Jobs werden weiterhin gecancelt wie bisher

### Helper Functions
- `public.is_tail_step_job_type(text) → boolean` (IMMUTABLE)
  Tail-Step-Jobtypes: `package_repair_exam_pool_quality`, `package_repair_exam_pool`,
  `package_validate_exam_pool`, `package_run_integrity_check`, `package_quality_council`,
  `package_auto_publish`
- `public.package_has_approved_artifacts(uuid) → boolean` (STABLE, SECURITY DEFINER)

## Eingriffspunkte (Trigger der historischen Drift)
- Production-Guardian schreibt `REBLOCK_AFTER_HEAL_OBSERVED reason=quality_no_progress_3x`
- Quelle: `package-run-integrity-check` Edge-Function ruft `fn_record_integrity_run_and_check_progress`
- Re-Block setzt status='blocked' + gate_class='terminal'
- Folge: `fn_auto_cancel_jobs_on_package_exit` cancelt Tail-Step-Jobs → AUTO_CANCEL Loop

## Audit-Queries
```sql
-- Wie oft greift der neue Defer?
SELECT date_trunc('hour', created_at) AS hour, count(*)
FROM auto_heal_log
WHERE action_type = 'tail_step_retryable_deferred'
  AND created_at > now() - interval '24 hours'
GROUP BY 1 ORDER BY 1 DESC;

-- Welche Pakete profitieren?
SELECT target_id, count(*) AS defer_count, max(created_at) AS last_defer
FROM auto_heal_log
WHERE action_type = 'tail_step_retryable_deferred'
  AND created_at > now() - interval '24 hours'
GROUP BY target_id ORDER BY defer_count DESC;
```

## Rollback
```sql
-- Helper droppen würde Trigger brechen, daher: nur Funktion auf alten Stand zurücksetzen.
-- Originalversion siehe Migration 20260429142932 (vor Patch).
```

## Folge-Schritte (falls Re-Block weiter auftritt)
1. Production-Guardian (Edge-Function `production-guardian`) prüfen — schreibt `REBLOCK_AFTER_HEAL_OBSERVED`
2. `dag_guard_block` für `package_auto_publish` bei missing `quality_council` dependency
   — sollte bei vorhandenem Tail-Step-Defer ebenfalls deferred statt blocked werden
