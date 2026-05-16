---
name: Track 5 Mobile Foundation Phase 2
description: Notification Outbox SSOT + Suppression-Engine + Streak-Recovery-Decider + Web-Push-Dispatcher + Notification-Prefs-Page.
type: feature
---
**Track 5 Phase 2 (2026-05-16) — Closed-Loop Notification-Orchestrierung.**

**SSOT Outbox `notification_jobs`:** kind (daily_reminder/rescue/streak_recovery/exam_countdown/weak_competency/readiness_summary) × channel × state (pending/suppressed/sending/delivered/failed/expired) × dedupe_key UNIQUE(user,kind,dedupe) × full audit (suppression_reason, attempts, delivery_result, expires_at default+24h). RLS: learner-owned read, admin read, **write nur via SECURITY DEFINER fns**.

**Suppression-Engine `fn_notification_should_suppress(user,kind,now)`** — Single-Source: channel-Optout / Quiet-Hours mit Overnight-Wrap (timezone-aware via `learner_notification_prefs`) / `fatigue_suppress` + Bridge-14 `intensity=wind_down` / max 3 pushes/24h / 30min same-kind cooldown / `exam_window_escalation` durchbricht Quiet-Hours NUR für `rescue|exam_countdown` in Phase `final|taper`.

**Choke-Point `fn_enqueue_notification(user,kind,curriculum,payload,dedupe,scheduled)`** — service_role only. Idempotent. Inline-Suppression-Check → state direkt 'suppressed' wenn reason. Audit `auto_heal_log` action_type=`notification_enqueue`.

**Decider `fn_streak_recovery_decide()` — Cron `streak-recovery-decide-daily` 04:00 UTC.** Scope: aktive `learner_course_grants` mit (streak≥2 + 1d gap) ODER (≥3d gap). Tonalität prüfungszentriert, kein Shaming. Audit-Summary.

**Dispatcher `admin_notification_claim_batch(limit)`** (service_role, FOR UPDATE SKIP LOCKED, pending→sending+attempts+1) + **`fn_record_notification_delivery(job,status,error,result)`** (delivered ODER failed mit Backoff: attempts<3 → pending+5min×attempts, sonst failed).

**Edge `send-learner-push`** (npm web-push@3.6.7, VAPID): claim batch → für jeden Job alle `learner_push_subscriptions` non-revoked senden → 404/410 markiert subscription revoked → any_ok=true→delivered, sonst failed. **Missing VAPID env → `{status:skipped,reason:no_vapid}`** (kein Datenverlust, Cron läuft idle weiter). **Cron `notification-dispatch-1min` jede Minute via pg_net.**

**UI `/app/benachrichtigungen` (AppNotificationsPage):** Kanäle (push/email) + Ruhezeiten (HH:MM) + Erschöpfungsschutz + Exam-Window-Eskalation + Explainability-Copy (kein Streak-Shaming, prüfungszentriert).

**Aktivierung:** VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY + VAPID_SUBJECT als Secrets erforderlich. Bis dann: Outbox + Decider + Suppression + Audit laufen vollständig — nur tatsächlicher Push wird übersprungen.

**Noch offen (Phase 3):** Browser-Subscription-Flow (Service-Worker-PushManager + Insert in learner_push_subscriptions), zusätzliche Decider (rescue, exam_countdown, weak_competency, readiness_summary), KPI-Card (Re-entry-24h, Suppression-Accuracy, Mastery-Delta-after-Push).
