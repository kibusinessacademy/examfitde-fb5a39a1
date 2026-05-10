---
name: Notification Delivery Health + Parity Guard Simulator v1
description: fn_check_notification_delivery_health (60min Window, skipped/failed-Reasons, no_enabled_destinations/high_skip_rate/high_failure_rate/stale_pending issues) + Cron notification-delivery-health-hourly. fn_simulate_parity_cron_guard(fresh|late|missing) für deterministische CI-Regression. Contract-Guard 21→24 Identifier. Audit action_type=notification_delivery_health.
type: feature
---

# Notification Delivery Health v1

Schließt die Beobachtungslücke nach Heal Alert Loop v1.1: erkennt, wenn Alerts systemisch im skipped/failed bleiben (fehlende Secrets, kaputte Webhooks, keine enabled Destinations, stehender Dispatcher-Cron).

## Komponenten
- `fn_check_notification_delivery_health(p_window_minutes int)` SECURITY DEFINER service_role — aggregiert `heal_alert_notifications` über N min, gruppiert skipped/failed Reasons, prüft 4 Issue-Codes (`no_enabled_destinations`, `high_skip_rate`, `high_failure_rate`, `stale_pending`), schreibt Audit `auto_heal_log.action_type='notification_delivery_health'` (status=ok/warn).
- `admin_get_notification_delivery_health(int)` — has_role-Gate, gleicher Output.
- Cron `notification-delivery-health-hourly` (`23 * * * *`).
- `fn_simulate_parity_cron_guard(p_scenario text)` — fresh/late/missing → deterministisches status+reason gegen `parity_cron_stale_hours`. Für CI-Regression `src/__tests__/parity-cron-guard.regression.test.ts`.

## Status-Logik
- `healthy` — keine Issues
- `degraded` — high severity Issues
- `critical` — mind. ein critical Issue (failure_rate ≥50%)

## Contract-Guard
`scripts/guards/lesson-join-parity-contract-guard.mjs` jetzt 24 Identifier (+4: fn_check, admin_get, cron-name, simulator).
