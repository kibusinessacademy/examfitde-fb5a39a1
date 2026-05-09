---
name: EXAM_FIRST Oral-Coverage Nightly Backfill
description: admin_heal_exam_first_oral_coverage RPC + nightly Cron 03:35 UTC enqueued package_seed_oral_blueprints für EXAM_FIRST/PLUS-Pakete ohne approved Oral-Blueprints. bronze_lock_override nur bei bronze_locked. Job-Policy exempt_from_auto_cancel=true + can_run_when_not_building=true verhindert Status-Transition-Drops. E2E tests/e2e/oral-coverage-postheal.spec.ts.
type: feature
---

## Problem
- 37 Seed-Jobs am Vortag enqueued, 34 davon `cancelled` durch `fn_auto_cancel_jobs_on_package_exit` (package status → quality_gate_failed/queued)
- 51 EXAM_FIRST/PLUS-Pakete blieben mit 0 approved Oral-Blueprints

## Fix
1. `job_type_policies.package_seed_oral_blueprints`: is_repair=true, can_run_when_not_building=true, exempt_from_auto_cancel=true
2. `admin_heal_exam_first_oral_coverage(p_dry_run, p_max)` SECURITY DEFINER, service_role/postgres only, mit has_role(admin)-Fallback
3. Nightly Cron `exam-first-oral-coverage-heal-nightly` (id 197) `35 3 * * *`
4. E2E `tests/e2e/oral-coverage-postheal.spec.ts` prüft approved-count + Trainer-Render

## Sofort-Lauf 2026-05-09
- 68 enqueued, 1 bronze-override, 0 skipped
- Run-ID a8f61b26-5982-4e54-a1d2-d41dc92d8283
