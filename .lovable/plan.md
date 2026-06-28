
# PIPELINE.RECOVERY.OS.1

Reines Recovery-OS. Keine Businesslogik. Kein Publish-Bypass. Kein Auto-Approve. Nur Plan → Operator-Approval → Execute → Audit.

## Scope-Guardrails (hart)
- Keine neuen Tabellen außer einer auditpflichtigen `pipeline_recovery_plans` (Plan-Cache + Idempotenz-Key) und einer `pipeline_recovery_actions` (executed actions). Beide nur über bestehende Audit-/RPC-Pfade.
- Keine Frontend-Mutationen ohne Reason+auto_heal_log (gem. Admin-UI-Leitstelle v1).
- Schreibpfade ausschließlich via neuer Edge Function `pipeline-recovery-act` + SECURITY DEFINER RPCs; Read via `pipeline-recovery-plan`.
- Council/Integrity dürfen NICHT direkt gesetzt werden — nur Re-Enqueue der bestehenden Steps (`run_integrity_check`, `quality_council`).

## Architektur

### Pure SSOT (deterministisch, side-effect-frei)
`src/lib/pipelineRecovery/`
- `contracts.ts` — Zod-Schemas: `RecoveryCause`, `RecoveryAction`, `RecoveryPlan`, `RecoveryRisk`, `RecoverySummary`.
- `publishGateRecovery.ts` — analysiert `done`-Pakete: QUALITY_NOT_FINISHED | COUNCIL_PENDING | AUDIT_PENDING | PROJECTION_PENDING | UNKNOWN. Output: nur `enqueue_done_reaudit`-Actions.
- `planningRecovery.ts` — `planning` + progress=0 + Alter > Threshold + kein aktiver Worker/Lock → `restartPlanning`.
- `lfRepairRecovery.ts` — Cycle-Counter (max 2) → `mark_manual_review_required`.
- `stuckLaneDetector.ts` — STUDIUM Track-/Worker-/Dispatcher-Routing-Diagnose, liefert nur Root-Cause.
- `providerFallback.ts` — bei PROVIDER_LOOP_GUARD / MAX_ATTEMPTS_EXHAUSTED → Plan mit `google/gemini-3.5-flash` (nur für 4 erlaubte job_types).
- `recoveryPolicy.ts` — Thresholds, Allowlists, verbotene Actions.
- `recoveryRisk.ts` — risk/confidence/impact/expected/fp_risk/operator_effort.
- `projection.ts` — baut `RecoverySummary`.
- `audit.ts` — Event-Builder.
- `index.ts` — Barrel.

Mirror für Edge-Runtime: `supabase/functions/_shared/pipelineRecovery/`.

### Edge Functions
- `pipeline-recovery-plan` (GET/POST, JWT) — ruft Pure SSOT mit aktuellem DB-Snapshot, liefert `RecoverySummary` + per-package `RecoveryPlan`.
- `pipeline-recovery-act` (POST, JWT + admin role) — führt EINE Action aus, idempotent via `plan_id+action_id`, schreibt `auto_heal_log` + `pipeline_recovery_actions`. Verbotene Actions werden hart abgelehnt.

### DB (minimal-invasiv, eine Migration)
- `pipeline_recovery_plans(id, generated_at, scope, summary jsonb, plan jsonb, hash text unique)`
- `pipeline_recovery_actions(id, plan_id, action_type, target_package_id, status, reason, actor_uid, executed_at, result jsonb)`
- RLS: admin-only, GRANTs an `authenticated` (+ service_role) gemäß Public-Schema-Grants.
- KEINE Schema-Änderungen an `course_packages`, `job_queue`, `package_steps`.

### Forbidden in Code (CI-Guard `scripts/guard-recovery-forbidden.mjs`)
Regex-Blocks im `pipelineRecovery/*`:
- `integrity_passed`/`council_approved` rechts vom `=`
- `is_published = true`
- direkte `.from('course_packages').update`

## Admin Heal Integration
Neue Cards in `src/components/admin/queue-cockpit/HealCockpitTabContent.tsx`:
- `PublishGateRecoveryCard`
- `PlanningRecoveryCard`
- `LfLoopRecoveryCard`
- `ProviderRecoveryCard`
- `DoneReauditCard`
- `WorkerRoutingDiagnosisCard`

Pflicht-Anatomie pro Card (Status/Severity/Root-Cause/Affected/Last Action/Next Action/Trend) gemäß `mem://constraints/admin-ui-leitstelle-v1`. Mutationen: Confirm-Dialog mit Reason, invalidateQueries, Toast.

## Audit-Events (via `fn_emit_audit`)
`pipeline_recovery_planned|started|completed|skipped|blocked|manual_review`

## Tests (≥50)
- `src/lib/pipelineRecovery/__tests__/`
  - publishGateRecovery (8): QUALITY/COUNCIL/AUDIT/PROJECTION/UNKNOWN/mixed/empty/idempotent
  - planningRecovery (7): worker_lost/claim_lost/dispatcher_off/active_worker_skip/lock_skip/age_threshold/empty
  - lfRepairRecovery (6): cycle_0/cycle_1/cycle_2_stop/manual_review_emit/no_loop/race
  - providerFallback (6): loop_guard/max_attempts/non_allowlisted_job/no_trigger/plan_only/idempotent
  - stuckLaneDetector (5): studium_no_worker/routing_off/dispatcher_off/healthy/mixed
  - recoveryRisk (5)
  - projection (5)
  - contracts (4)
  - forbidden-actions (4) — Versuche, integrity/council/publish zu mutieren ⇒ throw

Alle bestehenden Tests bleiben grün.

## Smoke
`scripts/pipeline-recovery-smoke.mjs` — Dry-Run, schreibt `/tmp/pipeline-recovery-report.md`.

## Definition of Done
- Pure SSOT + Mirror vorhanden.
- 2 Edge Functions deployt.
- 1 Migration mit 2 Recovery-Tabellen + RLS + GRANTs.
- 6 Heal-Cards integriert, Reason-Pflicht, Audit.
- ≥50 neue Tests grün, alte Tests grün.
- CI-Guard `guard-recovery-forbidden.mjs` registriert.
- Memory `.lovable/memory/features/pipeline-recovery-os-1.md`.

## Out-of-Scope (explizit nicht in diesem Cut)
- Tatsächliches Re-Routing von STUDIUM-Workern (nur Diagnose).
- Auto-Execute jeglicher Recovery-Action.
- Provider-Hotswap im Worker-Code.
- Änderungen an Curriculum/Question/Lesson/Product.
