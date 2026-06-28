---
name: PIPELINE.RECOVERY.OS.1
description: Pure-SSOT recovery for Publish-Gate, Planning-Lane, LF Anti-Loop, Provider-Fallback and STUDIUM-routing diagnosis. Plan → Operator-Approval → Execute → Audit. No publish bypass, no auto-approve.
type: feature
---

## Scope

Pure SSOT under `src/lib/pipelineRecovery/` mirrored to `supabase/functions/_shared/pipelineRecovery/`.
- `publishGateRecovery` analyses `status=done` and only emits `enqueue_done_reaudit` (re-runs `run_integrity_check` + `quality_council` jobs) — never sets integrity/council/publish.
- `planningRecovery` finds `planning + progress=0 + age>60min` with no active worker/lock → `restart_planning` plan.
- `lfRepairRecovery` stops `package_repair_exam_pool_lf_coverage` after 2 cycles → `mark_manual_review_required`.
- `providerFallback` proposes `google/gemini-3.5-flash` for the 4 allow-listed jobs on `PROVIDER_LOOP_GUARD` / `MAX_ATTEMPTS_EXHAUSTED`.
- `stuckLaneDetector` STUDIUM diagnose only.

## Edge Functions
- `pipeline-recovery-plan` (POST, JWT) → snapshot + `RecoverySummary`.
- `pipeline-recovery-act` (POST, JWT + admin) → executes ONE action via existing RPC/job-enqueue paths, idempotent on `action_id`, writes `auto_heal_log`.

## Tables
- `pipeline_recovery_plans` (cache + hash)
- `pipeline_recovery_actions` (executed actions, audit)
Both RLS admin-only, grants per public-schema-grants contract.

## Invariants
- Never mutates `integrity_passed`, `council_approved`, `is_published`, `published_at`.
- All actions `auto_executable = false`.
- Forbidden patterns enforced by `scripts/guard-recovery-forbidden.mjs`.

## UI
`/admin/heal` cockpit hosts `PipelineRecoveryCard` (aggregated). All mutations require Reason + Confirm.
