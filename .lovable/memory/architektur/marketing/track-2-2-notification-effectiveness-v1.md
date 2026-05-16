---
name: Track 2.2 Notification Effectiveness
description: cta_clicked + goal_resolved Events, Recovery-Routing-Worker (ignored→inapp_reminder→followup_email→escalation), Suppression Governance UI, Registry-driven Trust-UX.
type: feature
---

# Track 2.2 — Notification Effectiveness

## Events erweitert
- `record_notification_event` akzeptiert nun zusätzlich `cta_clicked` + `goal_resolved`.
- Service Worker hängt `?nj_cta=1` an URL beim notificationclick → `useNotificationAttribution` schreibt `cta_clicked` (idempotent via sessionStorage + DB-Unique).
- `learner_mark_intent_resolved(intent_key, metadata)` produziert `goal_resolved` für offene Jobs desselben Intent (14d-Fenster, idempotent).
- Helper-Export: `markNotificationIntentResolved` aus `src/hooks/useNotificationAttribution.ts`.

## Recovery Routing (auditierbar, idempotent)
- Tabelle `notification_recovery_audit` (UNIQUE source_job_id+to_action) — Service-Role only writes, Admin-RLS read.
- `admin_run_notification_recovery_routing(dry_run)` mit 3 Stages:
  - A: delivered >6h ohne open/cta → `inapp_reminder`
  - B: 2+ ignored gleicher Intent in 7d → `followup_email`
  - C: 4+ ignored gleicher Intent in 14d → `escalation`
- Cron `notification-recovery-routing-15min` (alle 15 Min).

## Governance + Trust-UX
- `notification_intent_registry` ist alleinige Quelle für „Warum bekomme ich das?" — LearnerNotificationHistory zieht `trigger_reason` + Limits + Quiet-Hours/Fatigue-Flags.
- `admin_set_intent_enabled(key, enabled, reason)` togglet Intent + auditiert in `auto_heal_log` (action_type=notification_intent_toggle, Reason-Pflicht in UI).
- `admin_get_suppression_audit` + `admin_get_recovery_audit` (SECURITY DEFINER + has_role).

## Admin-Cockpit Cards (Heal-Cockpit Diagnostics)
- `NotificationSuppressionGovernanceCard` — Suppression-Mix, Intent-Toggle mit Reason-Input.
- `NotificationRecoveryRoutingCard` — Dry-run + Routen-Button, 7-Tage-Audit-Stream.
- Bestehende: KPI, Attribution, Health, ActionFunnel (Track 2.1) bleiben.

## Tests
- `src/__tests__/notification-attribution-track-2-2.test.ts` — Param-Parsing (nj/nj_k/nj_cta) + registry-driven whyText-Logik.

## SSOT-Disziplin
- Keine direkten Client-Reads auf `notification_jobs`/`notification_events` — alles via SECURITY DEFINER RPCs.
- `cta_clicked` ist exklusiv Service-Worker-initiiert (kein In-App-Trigger ohne `nj_cta=1`).
