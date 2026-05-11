---
name: Integrity Runner Mapping v2 + complete_job CAS
description: job-runner routet ok:true+integrity_passed:false direkt auf failed/QUALITY_THRESHOLD_NOT_MET (kein Trigger-Rollback mehr). Worker exposed integrity_passed top-level + setzt step.status='failed' wenn Gate fällt. Terminal job_queue UPDATE CAS-guarded gegen status='processing' + Audit complete_job_cas_conflict.
type: feature
---

## Problem
Integrity-Worker returned `{ok:true, report:{integrity_passed:false}}`. Runner fiel in Completed-Branch → trg_job_complete_reconcile_step setzte step.status='done' → fn_guard_governance_step_finalization RAISED EXCEPTION ("integrity_passed=false") → komplettes job_queue UPDATE rolled back → Job blieb 'processing' bis Reaper. Endlosloop.

## Fix v2
1. **Worker** (`package-run-integrity-check`):
   - Top-level Return: `integrity_passed`, `gate_passed`, `score`, `hard_fail_count`, `error_code` (=`QUALITY_THRESHOLD_NOT_MET` bei Fail).
   - Step-Update: `status: gatePassed ? 'done' : 'failed'` (governance-trigger-konform).
2. **Runner** (`job-runner`):
   - Neue Branch im Completed-Handler **vor** SKIP-Guard: prüft `parsed.integrity_passed | parsed.gate_passed | parsed.report.integrity_passed | parsed.report.gate_passed`. Bei `false` → `finalState=failed` mit `last_error='QUALITY_THRESHOLD_NOT_MET'`.
   - Materialization-Guard skipt (`if (finalState) artifactCheck={ok:true}`).
   - Final completion-Pfad nur noch `else if (!finalState)`.
3. **CAS** auf terminalem job_queue UPDATE: `.eq("id",job.id).eq("status","processing")` + Retry-Pfad ebenfalls. Bei 0 rows: Audit `complete_job_cas_conflict` mit observed_status.

## Cleanup
Migration reklassifiziert alle in `processing` festhängenden integrity-Jobs mit `meta.last_stage='handler_done'`:
- `cp.integrity_passed=true` → completed
- sonst → failed (`last_error='QUALITY_THRESHOLD_NOT_MET'`)
Audit pro Job in `auto_heal_log` (action_type=`integrity_handler_done_reclassify`).

## Vertrag
- `src/test/ops/integrity-runner-mapping.contract.test.ts` (8/8 grün) verriegelt:
  - Worker top-level integrity_passed
  - Worker conditional step status
  - Runner integrity-gate-fail branch
  - Runner liest beide Quellen (top-level + nested)
  - Materialization-Guard ehrt finalState
  - CAS in Primary + Retry
  - CAS-Conflict Audit
  - Invariant: ok:true+gate_passed:false MUST NOT step.done

## Lehre
Worker und Runner müssen denselben SSOT für Pass/Fail teilen — sonst rollt ein governance-AFTER-Trigger den Runner-Write zurück. Fail-Signale gehören **top-level** in das JSON-Result, nicht nur nested. Terminal-Writes brauchen **immer** CAS gegen den erwarteten Vorzustand.

## Files
- `supabase/functions/job-runner/index.ts`
- `supabase/functions/package-run-integrity-check/index.ts`
- `supabase/migrations/20260511_integrity_handler_done_reclassify.sql`
- `src/test/ops/integrity-runner-mapping.contract.test.ts`
