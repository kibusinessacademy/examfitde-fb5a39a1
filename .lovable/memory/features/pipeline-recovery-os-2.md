---
name: Pipeline Recovery OS.2 — Execute + Verify
description: Batched recovery runs with deterministic outcome verification; no publish/integrity bypass.
type: feature
---

# PIPELINE.RECOVERY.OS.2

## Mission
Kontrollierte Ausführung der OS.1-Pläne als Run-Batch + deterministische Outcome-Verifikation.

## SSOT modules (pure)
- `src/lib/pipelineRecovery/runOutcome.ts` — `classifyOutcome`, `aggregateRunOutcome`, `RECOVERY_RUN_POLICY`
- Edge mirror: `supabase/functions/_shared/pipelineRecovery/runOutcome.ts`

## Edge functions
- `pipeline-recovery-run` — admin-only; captures pre-snapshot pro Paket, ruft `pipeline-recovery-act` je Action, schreibt `pipeline_recovery_runs`. Max 25 Aktionen/Run.
- `pipeline-recovery-verify` — admin **oder** internal (`x-cron-secret`); probt post-state, klassifiziert, persistiert `verification_status/detail`, updated Run-Status.

## DB
- `pipeline_recovery_runs` (run_id, status, pre/post_snapshot, outcome, action_ids).
- `pipeline_recovery_actions` erweitert um `run_id`, `pre_state`, `post_state`, `verification_status`, `verification_detail`.

## Verification policy
- 60s Grace-Window vor Klassifikation
- 30min Timeout → `verification_timeout`
- Per-Action: `verified_success | verified_no_change | verified_regressed | pending_verification | skipped`
- Per-Run: `verified | verified_partial | verified_regressed | verifying`

## Hard guards
- `scripts/guard-recovery-forbidden.mjs` scannt jetzt auch alle 4 Recovery-Edge-Functions auf direkte Mutationen von `integrity_passed/council_approved/is_published` und `course_packages.update(...)`.
- Verify-Pfad mutiert ausschließlich `pipeline_recovery_*`-Tabellen.

## Tests
66 Tests grün (51 OS.1 + 15 OS.2). Outcome-Klassifikation deterministisch und seitenwirkungsfrei.

## UI
- `/admin/heal` → neue `PipelineRecoveryRunsCard` listet letzte 15 Runs, zeigt success/no_change/regressed/pending, „Verifizieren"-Button.

## Audit
- `auto_heal_log` Einträge: `pipeline_recovery_run_executed`, `pipeline_recovery_run_verified` (mit Per-Action-Verdicts).
