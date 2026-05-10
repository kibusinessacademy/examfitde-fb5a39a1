---
name: Access SSOT Single Choke-Point v1
description: tutor_access_check + has_storage_entitlement akzeptieren grants ODER entitlements; admin_get_access_ssot_health + fn_run_access_ssot_drift_heal + Cron 15min; AccessSsotHealthCard im Diagnostics-Tab
type: feature
---
Loop-C Bridge final: tutor_access_check und has_storage_entitlement lesen jetzt grants ODER entitlements (vorher nur entitlements → 68 grant-only User für Tutor+PDF blockiert). admin_get_access_ssot_health() liefert paid_no_grant/grants_no_ent/tutor+storage_blocked, getrennt smoke vs real. fn_run_access_ssot_drift_heal() ruft admin_repair_paid_orders_without_grant + admin_repair_grant_entitlement_drift mit stable Admin-Caller, 9min Cooldown, Audit action_type='access_ssot_drift_heal_run'. Cron access-ssot-drift-heal-15min (*/15). UI: AccessSsotHealthCard im Diagnostics-Tab mit Repair-Button (admin_run_access_ssot_drift_heal). Backfill 2026-05-10: grants_no_ent 68→0, tutor/storage_blocked 0. Verbleibende 6 paid_no_grant_with_items sind alle smoke (paid_no_grant_smoke=18=total).
