---
name: Track 5 Mobile Foundation Phase 4
description: Push-Outcome-Loop — Attribution-Events, Learning-Impact-KPIs, Suppression-Quality, Trust-UX, Admin-Health.
type: feature
---
**Track 5 Phase 4 (2026-05-16) — Push wird messbare Lernsteuerung.**

**Attribution SSOT `notification_events`:** event_type ∈ {notification_opened, reentry_from_push, session_started_from_notification, minicheck_started_from_notification, minicheck_completed_from_notification, mastery_delta_post_notification, readiness_recovery_post_rescue} × UNIQUE(job_id,event_type). RLS: owner+admin read, write nur via SECURITY DEFINER `record_notification_event(job_id,event_type,metadata)` (auth + ownership check).

**Service-Worker:** `notificationclick` hängt `?nj=<job_id>&nj_k=<kind>&nj_t=<ts>` an deeplink. Hook `useNotificationAttribution` (mounted in App.tsx nach useGtmPageView) liest Params → RPC `record_notification_event` für opened+reentry+session_started (sessionStorage-dedupe je job_id) → strip params via navigate replace.

**Admin RPCs (alle `has_role('admin')` Gate):**
- `admin_get_notification_attribution(window_hours=168)` → delivered/opened/reentry/session/minicheck/mastery + open_rate_pct, session_per_open_pct, rescue_recovery_pct, opened_by_kind.
- `admin_get_suppression_quality(window_hours=168)` → by_reason + fatigue/quiet/optout/cooldown/cap counts + signal_over_suppression(>70%) / signal_under_send(<5/24h) / signal_fatigue_dominant(>60%) + exam_window_overrides.
- `admin_get_notification_health()` → active_subs, delivered 1h/24h, failed_1h, invalid_token_1h, pending(_stale), suppression_pct_1h, cron_last_seen_at + signal_no_subscriptions/cron_stale/delivery_drop/invalid_token_spike/suppression_spike/pending_stale.

**Learner Trust UX:** `learner_get_recent_notifications(p_limit)` → letzte 20 Jobs mit kind/state/suppression_reason/was_opened. Komponente `LearnerNotificationHistory` zeigt „Warum?“-Begründung pro Event (Kind-Mapping + Reason-Mapping prüfungszentriert, kein Shaming) auf `/app/benachrichtigungen`.

**Admin Cockpit:** drei Karten side-by-side in HealCockpitPage Sektion: `NotificationKpiCard` (Outbox), `NotificationAttributionCard` (Outcome 7d), `NotificationHealthCard` (Signals + Suppression-Mix). Health-Card pingt `send-learner-push` und visualisiert `skipped:no_vapid` als roten Alarm.

**Operational:** Attribution idempotent (unique(job_id,event_type) → ON CONFLICT DO NOTHING). Cron-Stale-Detection nutzt auto_heal_log Best-Effort + Fallback auf `last_attempt_at > 30min`. Cleanup invalid tokens läuft weiter in send-learner-push (404/410 → revoked_at).

**Noch offen:** MiniCheck-/Mastery-Auto-Recording (server-side im snapshot-Pfad statt clientseitig), Rescue-Recovery Snapshot-Hook, Cron `notification-attribution-rollup-daily` für Weekly-Report.
