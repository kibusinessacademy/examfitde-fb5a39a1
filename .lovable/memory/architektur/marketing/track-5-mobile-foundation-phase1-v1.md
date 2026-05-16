---
name: Track 5 Mobile Foundation Phase 1
description: SSOT-Tabellen + RPC für Re-Entry, Push-Tokens, Notification-Prefs; MobileReEntryCard + MobileWebBottomNav.
type: feature
---
**Track 5 — Mobile Foundation Phase 1 (2026-05-16).**

**Distribution-Layer für Bridges 14–16.** Kein neuer Intelligence-Layer (Architecture Freeze post Bridge 16 bleibt aktiv).

**SSOT-Tabellen (RLS, learner-owned):**
- `learner_push_subscriptions` — Web-Push-Token-Lifecycle (endpoint UNIQUE per user, p256dh, auth_key, platform, last_seen_at, revoked_at).
- `learner_notification_prefs` — Channels (push/email), quiet_hours_start/end, fatigue_suppress, exam_window_escalation, timezone (Europe/Berlin default).
- `learner_re_entry_events` — Analytics-Stream: 10 event_types (app_open, resume_clicked, push_received/opened, rescue_accepted/dismissed, reminder_seen, session_resumed, streak_recovered, daily_challenge_started).

**RPC `learner_get_re_entry_state(p_curriculum_id)`** (SECURITY DEFINER, auth.uid()-scoped, GRANT authenticated):
- Aggregiert `learning_session_patterns` (last_session_at, days_since_last) + `user_learning_streaks` (current/longest) + `exam_window_states` Bridge 15 (phase, days_to_exam, intensity).
- Deterministische Suggested-Action-Ladder: wind_down→rest_today, no_history→start_first, ≥3d gap mit Streak→recover_streak, sharpen/final→sim_session, today→continue_today, else→resume.
- Audit pro Aufruf in `auto_heal_log` (action_type=`learner_re_entry_state_call`).

**UI:**
- `MobileReEntryCard` (auf LearnerDashboard über LearnerIntelligenceCard): Streak-Chip + Exam-Countdown + Single CTA mit Deeplink.
- `MobileWebBottomNav` (in App.tsx, nur isMobile && !isNative && !/admin && !/auth): 5-Tab-Nav (Start/Kurse/Trainer/Shop/Profil), spiegelt NativeTabBar für PWA + Mobile-Web.
- `trackReEntryEvent()` Helper für Re-Entry-Event-Insert.

**Noch offen (Phase 2):**
- Push-Send-Pipeline (VAPID-Secret + send-learner-push Edge Function).
- Quiet-Hours- + fatigue_suppress-Enforcement im Sender.
- Notification-Preferences-Page für Learner.
- Streak-Recovery-Trigger nach Session-Insert.
