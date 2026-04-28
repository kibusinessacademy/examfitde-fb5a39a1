---
name: Heal-Status Dashboard + Per-Step-Retry + Auto-Heal-Plan
description: Pro-Kurs/Track Heal-Status (vorher/geheilt/failed) mit Skip-Reasons, Per-Step-Retry Buttons und Auto-Heal-Plan mit Job-Block-Check (pausiert wenn aktive Pipeline-Jobs)
type: feature
---

## Architektur

### DB-Layer (SECURITY DEFINER)
- `v_admin_heal_status_per_package`: pro Paket Aggregat aus auto_heal_log (success/skipped/failed counts + last_reason + Zeitstempel) + package_steps (failed_step_keys) + job_queue (active_jobs). Computed `heal_state`: jobs_running | has_failed_steps | last_heal_failed | healed | no_heal_history | pending.
- `v_admin_heal_status_by_track`: Aggregat pro Track für Dashboard-Header.
- `admin_retry_failed_step(p_package_id, p_step_key, p_reason)`: SECURITY DEFINER, Admin-only. Block-Check via job_queue (step_key match oder job_type ILIKE) → skipped+log wenn aktive Jobs. Sonst delegiert an `admin_step_reset_detailed` mit `p_nudge_atomic := true`. Logged in auto_heal_log als `PER_STEP_RETRY`.
- `admin_auto_heal_remaining(p_max_packages, p_dry_run)`: iteriert über heal_state IN ('has_failed_steps','last_heal_failed'). Pro Paket: aktive Jobs > 0 → action='skip' mit klarer Begründung. Sonst reset_and_nudge via admin_step_reset_detailed. Dry-Run möglich. Logged als `AUTO_HEAL_REMAINING`.

### UI
- `src/components/admin/heal/cards/HealStatusCard.tsx` im HealCockpitPage Sektion 3c (default-open).
- Track-Tiles als Filter-Chips, Status-Filter, Per-Step-Retry-Buttons (disabled wenn active_jobs>0), Auto-Heal Dry-Run/Execute mit max-Cap.

### Skip-Reasons (sichtbar in UI)
- "Pipeline-Jobs aktiv (N) — Auto-Heal pausiert bis Jobs abgeschlossen"
- "jobs_already_running" (Per-Step-Retry mit aktiven Jobs für diesen Step)
- "reset_failed: <SQLERRM>"
