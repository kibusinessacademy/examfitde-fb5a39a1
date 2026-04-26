---
name: Cockpit Blind-Blocker Fix v1
description: v_admin_track_control liest integrity_passed/report aus course_packages (SSOT) statt aus package_steps.meta. v_admin_publish_readiness differenziert primary_blocker in NEVER_CHECKED/DEFERRED/REPORT_MISSING/FAILED. Cluster-View + aggressiver Stale-Reaper (cron 10min, cancel bei stale_recoveries>=5).
type: feature
---

## Root Cause
- `v_admin_track_control.integrity_passed` las aus `package_steps.meta->>'validation_passed'` (immer NULL → integrity_passed=false bei 99% Pakete).
- `v_admin_publish_readiness.primary_blocker` mappte `integrity_passed IS NOT TRUE` generisch auf `INTEGRITY_FAILED` ohne Sub-Klassen.
- Die Edge Function `package-run-integrity-check` schrieb im DEFERRED-Pfad keinen `integrity_report`.

## Fix
1. **View-SSOT-Switch**: `v_admin_track_control` zieht jetzt `integrity_report` und `integrity_passed` direkt aus `course_packages`.
2. **Differenzierter Blocker**: `INTEGRITY_NEVER_CHECKED` (report NULL), `INTEGRITY_DEFERRED` (report.deferred=true), `INTEGRITY_REPORT_MISSING` (report leer / kein reason_code), `INTEGRITY_FAILED` (echter Hard-Fail).
3. **Defer-Pfad schreibt minimalen Report**: Edge Function persistiert bei deferred {ok:false, executed:false, deferred:true, reason_code, gate_class, defer_reason}. Auch NO_CURRICULUM schreibt jetzt einen Report.
4. **Cluster-View** `v_admin_publish_blocker_clusters` mit empty_integrity_reports/integrity_failed_count/integrity_deferred_count.
5. **Aggressiver Reaper** `fn_reap_stale_jobs_aggressive()` (cron `*/10 * * * *`): cancel bei transient_attempts>=5 mit liveness_requeued, unlock orphan locks, terminal-block bei attempts>=max_attempts.

## Cockpit-Komponenten
- `IntegrityHealthBanner.tsx` (bestehend)
- `PublishBlockerClustersBanner.tsx` (neu) — aggregierte Top-KPI-Übersicht.

## Effekt
Vorher 54 Pakete blind als INTEGRITY_FAILED gelabelt. Nachher: 40 OK, 8 QualityCouncilPending, 3 NeverChecked, 1 ExamPoolTooSmall, 1 ReportMissing.
