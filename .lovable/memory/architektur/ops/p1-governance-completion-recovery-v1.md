---
name: P1 Governance Completion Recovery v1
description: Deterministic recovery for packages with approved≥150 but missing quality_report — single governance job dispatch with 6h idempotency
type: feature
---

SSOT: v_governance_completion_recovery_targets (service_role only) listet Pakete mit approved_question_count≥150, quality_report IS NULL, nicht published/archived/failed_terminal/manual_hold, ohne active governance job, ohne bronze.manual_review_required.

Dispatch: admin_dispatch_governance_completion_recovery(limit≤100, dry_run=true default) — has_role-Gate, dispatchst pro Paket genau EINEN package_quality_council job (priority 50, enqueue_source=governance_completion_recovery). Niemals publish, niemals integrity, niemals content rebuilds.

Guards: active_governance_job_exists | idempotency_6h_cooldown | too_many_council_failures_24h (>5) | bronze_manual_review_required.

Audit: auto_heal_log action_types governance_completion_recovery_dispatched / _skipped (Pflicht-Metadata: package_key, reason_codes, skip_reason|job_id, risk_level).

Summary: admin_get_governance_completion_recovery_summary() → pending_targets, dispatched_24h, recovered_24h (quality_report jetzt vorhanden), skipped_24h, packages_still_missing_reports, top_reason_codes.

Baseline 2026-05-24: 74 targets pending / 64 dispatchable / 10 blocked (active job). Top reasons: no_quality_report=74, council_not_approved=73, integrity_downstream_failure=9. All risk_level=low (keine recent council failures). Top-Pakete: bwl_bachelor__studium (2354 approved), brenner_in__exam_first (1349), fachinformatiker_digitale_vernetzung__ausbildung_voll (1073).
