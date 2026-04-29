---
name: Idle-Building Auto-Heal
description: Erkennt building-Pakete ohne aktive Jobs (>6h idle) und nudged ältesten offenen Step. View v_idle_building_packages + RPC admin_heal_idle_building_packages + Cron alle 30min.
type: feature
---

# Idle-Building Auto-Heal — 2026-04-29

## Problem
Building-Pakete ohne aktive Jobs verbrennen WIP-Slots ohne Pipeline-Output. Beobachtet: 7 building-Pakete idle, 6 davon >24h.

## Komponenten

**View `v_idle_building_packages`**
- status='building', archived≠true, KEIN job in (processing/pending/queued/retry_scheduled/batch_pending), last_progress_at < now()-5min
- Liefert: package_id, title, hours_idle, next_open_step (älteste queued/failed/blocked/timeout Step), done_steps/total_steps

**RPC `admin_heal_idle_building_packages(p_dry_run, p_threshold_hours, p_max)`**
- Defaults: (true, 6, 10)
- Pro Paket: nudge ältesten offenen Step (attempts=0, last_error=NULL, meta.reset_reason='idle_building_auto_heal')
- Touch course_packages.last_progress_at = now() damit nicht sofort wieder erkannt
- Skip-Reasons: skip_no_open_step, skip_step_id_not_found
- Audit: auto_heal_log mit action_type='idle_building_auto_heal'
- Auth: erlaubt service_role (für Cron) + admin

**Cron `idle-building-auto-heal`**
- Schedule `*/30 * * * *` (alle 30min)
- Aufruf: `admin_heal_idle_building_packages(false, 6, 10)`

## Manuelle Nutzung
```sql
SELECT admin_heal_idle_building_packages(true, 1, 20);   -- Dry-Run
SELECT admin_heal_idle_building_packages(false, 6, 10);  -- Execute
SELECT * FROM v_idle_building_packages ORDER BY hours_idle DESC;
```
