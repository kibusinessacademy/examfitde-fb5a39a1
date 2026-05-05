---
name: Bronze-Guard Admin-Override v1
description: fn_is_bronze_locked respektiert admin_force_building_at und bronze.manual_bypass=true als harten Override. Verhindert Bronze-vs-Admin-Intent-Loops.
type: feature
---

## Problem (24h-Forensik 2026-05-05)
- 7.424 `bronze_locked_enqueue_blocked` Events auf 31 Pakete
- 28 Pakete hatten gleichzeitig `bronze.requires_review=true` UND `admin_force_building_at` → Cron/Watchdog versuchen permanent zu enqueuen, Bronze-Guard blockt jedes Mal
- 3.754 `pipeline_step_drift_v3_heal` Re-Heals, weil bronze-blocked Jobs nie ins job_queue gelangen → Drift-Detector sieht "no active job" → re-queued in Endlosschleife (alternierende Steps umgehen 30-Min-Cooldown)

## Root-Fix
`fn_is_bronze_locked(p_package_id)` ignoriert bronze-Flags wenn:
- `feature_flags ? 'admin_force_building_at'` (Admin hat explizit aus Stall geholt) ODER
- `feature_flags->'bronze'->>'manual_bypass' = 'true'` (manueller Operator-Bypass)

## Bypass-Pattern für Bronze-Loops
1. Audit-Tag `bronze.manual_bypass=true` + `bronze.manual_bypass_at=now()` setzen
2. `auto_heal_log(action_type='manual_bypass_bronze_loop', metadata.reason)` schreiben
3. Optional: pending bronze-blocked Jobs cancellen mit `last_error='manual_bypass: bronze_loop_cleanup'`

## Drift-v3-Loop-Stop
Steps mit >20 `pipeline_step_drift_v3_heal` Erfolgen in 24h → `status='failed'` mit `last_error='manual_bypass: drift_v3_loop ...'`. Trigger-Konflikt mit `fn_clear_stale_package_flags` → Bypass via `SET session_replication_role='replica'`.
