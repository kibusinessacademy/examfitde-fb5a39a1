---
name: P1.1 Governance Recovery Verifier v1
description: Audit-only verifier — proves whether governance completion recovery actually wrote quality_report. No requeues, no status changes. Dry-run mode + SQL smoke test.
type: feature
---

## SSOT
- View `v_governance_completion_recovery_outcomes` (service_role only, 7d window): joins `auto_heal_log` (action_type=governance_completion_recovery_dispatched) → `job_queue` → `course_packages.quality_report`. Liefert pro Dispatch: job_status, quality_report_written, quality_score, council_approved, recovered, stuck, failure_reason, minutes_since_dispatch, is_latest_dispatch.
- Klassifikation: `recovered = quality_report IS NOT NULL AND job.status='completed'`. `stuck = quality_report NULL AND age>60min AND (job.failed/cancelled OR pending/processing>120min)`.

## Verifier
- `fn_verify_governance_completion_recovery()` (service_role) — läuft auf is_latest_dispatch UND age≥5min UND <24h. Schreibt EIN Audit pro (package, job_id, classification): `governance_completion_recovery_verified` (recovered=true) ODER `_stuck` (stuck=true). Idempotent (EXISTS-Check). KEINE Mutationen außer auto_heal_log.

## Admin-RPCs (has_role gated)
- `admin_get_governance_completion_recovery_outcomes(hours)` — Liste, max 168h.
- `admin_get_governance_completion_recovery_outcomes_summary(hours)` — KPIs: dispatched_24h, recovered_24h, stuck_24h, pending_24h, recovery_rate (%), avg_minutes_to_recover, top_failure_reasons (top 5).

## Cron
- `governance-completion-recovery-verify-30min` — `*/30 * * * *` ruft `fn_verify_governance_completion_recovery()`.

## Audit-Contracts (ops_audit_contract)
- `governance_completion_recovery_verified`: required_keys=[package_key,job_id,recovered,stuck,minutes_since_dispatch]
- `governance_completion_recovery_stuck`: required_keys=[package_key,job_id,failure_reason,minutes_since_dispatch]

## Garantien
- Kein Auto-Requeue, kein Publish, kein Integrity-Dispatch, keine Statusänderung an course_packages oder job_queue.
- Keine Audit-Spam: pro (package_id, job_id, classification) genau ein Eintrag.
- View nur service_role, RPC nur authenticated+admin.
