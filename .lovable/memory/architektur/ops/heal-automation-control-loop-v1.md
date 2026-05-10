---
name: Heal Automation Control Loop v1
description: Audit-Trail (heal_run_audit), Parity-Cron-Guard (täglich 04:07), Mismatch+Enqueue-Rate Alerts (15min) mit konfigurierbaren Thresholds in heal_alert_config, Heal-Queue-Audit (48h), Drift-Coverage-Matrix als SSOT, Regression-Guard CI.
type: feature
---

# Heal Automation Control Loop v1

Schließt den Regelkreis um die `lesson-join-parity-daily` Self-Heal-Pipeline.

## Komponenten
- **Audit-Trail**: `fn_record_heal_run_audit(origin, recommended_action, package_ids, jobs, status, detail)` → `auto_heal_log` action_type=`heal_run_audit`. Reader: `admin_get_heal_run_audit_trail(p_limit)` (auch `lesson_join_parity_check`, `parity_cron_guard`, `parity_mismatch_alert`).
- **Parity-Cron-Guard**: `fn_run_parity_cron_guard()` prüft ob `lesson-join-parity-daily` existiert+aktiv ist und der letzte Lauf ≤ `parity_cron_stale_hours` (default 36h) zurückliegt. Cron `parity-cron-guard-daily` 04:07 UTC. Reader: `admin_get_parity_cron_health()`.
- **Mismatch+Enqueue-Rate Alerts**: `fn_run_heal_alert_evaluator()` (Cron `heal-alerts-15min`) liest letzten Parity-Run, vergleicht gegen `parity_mismatch_count` (default 0) und `parity_enqueue_rate_per_run` (default 5). Schreibt action_type=`parity_mismatch_alert` mit alerts[] inkl. `deep_link`. Konfig: `heal_alert_config` Tabelle, RLS admin-only. Update via `admin_update_heal_alert_config(key,threshold,enabled)`.
- **Heal-Queue-Audit**: `admin_get_heal_queue_audit(p_hours)` aggregiert `admin_course_auto_heal_queue` mit source=`lesson_join_parity` über letzte N Stunden, returns pending/processing/done/failed/cancelled + completion_pct.
- **Drift-Coverage-Matrix**: `admin_get_drift_coverage_matrix()` SSOT für domain × {check, cron, audit, guard, self_heal, cockpit, status}.
- **Cockpit-UI**: `HealAutomationControlCard` (5 Tabs) im Diagnostics-Tab nach `LessonJoinParityCard`.
- **Regression-Guard CI**: `scripts/guards/lesson-join-parity-contract-guard.mjs` greppt 14 Identifier aus `supabase/migrations/`. Workflow `lesson-join-parity-contract-guard.yml`.

## Schwellen (Default)
- `parity_mismatch_count` = 0
- `parity_enqueue_rate_per_run` = 5
- `parity_cron_stale_hours` = 36

## Audit Action Types
- `heal_run_audit` – jeder Heal-Run
- `lesson_join_parity_check` – Daily Parity-Lauf
- `parity_cron_guard` – Cron-Health
- `parity_mismatch_alert` – Alert-Eval (15min)
- `heal_alert_config_update` – Config-Änderung
