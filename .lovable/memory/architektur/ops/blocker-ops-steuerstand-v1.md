---
name: Blocker Operations Steuerstand v1
description: Single-Pane-of-Glass /admin/ops/blocker-ops für die 4 echten Publish-Blocker mit Targeted-Recheck Before/After, Deferred-Resolved-Alerts, Auto-Selector für Exam-Pool-Repair und konfigurierbarem Reaper inkl. Audit-Log.
type: feature
---

## Backend
- `v_admin_blocker_dashboard` — Drill-down auf NEVER_CHECKED/DEFERRED/COUNCIL_PENDING/EXAM_POOL_TOO_SMALL inkl. defer_reason.
- `v_admin_deferred_resolved_alerts` — Pakete mit DEFERRED + Bedingung erfüllt (approved_questions ≥ track-min) → safe re-enqueue.
- `fn_select_exam_pool_repair_action(uuid)` — Defect-aware: lf_gap≥10% → lf_coverage; comp_gap≥15% → competency_coverage; sonst quality (mit volume_gap als Reason).
- `admin_settings.reaper_config` — `{ stale_recoveries_threshold, max_cancels_per_run, orphan_lock_minutes, cron_interval_minutes, enabled }`.
- `fn_reap_stale_jobs_configurable()` — liest config, schreibt jeden Cancel/Unlock/Terminal in `admin_reaper_audit`.
- `admin_reaper_audit` — Tabelle für jede Reaper-Aktion (job_id, package_id, action, reason, attempts, config_snapshot).

## Frontend
- Route: `/admin/ops/blocker-ops`
- 4 Counter-Cards (klickbar als Filter)
- Tab "Targeted Recheck": Dry-Run + Execute mit Job-Queue Snapshot Before/After pro job_type
- Tab "Drill-down": gefilterte Tabelle pro Blocker
- Tab "Auto-Selector": Input + Quick-Links für EXAM_POOL_TOO_SMALL Pakete
- Tab "Reaper-Governance": Threshold-Form, "Jetzt ausführen", Audit-Log Tabelle
- Deferred-Resolved-Alerts als persistenter Banner oben

## Wiring
- Cockpit-Banner `PublishBlockerClustersBanner` enthält Link "Steuerstand öffnen →"
