---
name: Delivered → Activated Bridge v1
description: Activation orchestrator fires 6 jobs on first learner_course_grants.activated_at. SSOT v_learner_activation_state mit 6 States. SLA 10min.
type: feature
---

## Trigger
`trg_learner_grant_activation_fanout` AFTER INSERT/UPDATE OF activated_at auf `learner_course_grants` — feuert exakt einmal pro Grant (idempotency_key `learner_activation|<grant_id>|<job_type>`).

## Fanout (6 Jobs, lane=learner, pool=core)
- `activation_welcome_sequence_enqueue` → schreibt email_delivery_queue (Loop B übernimmt)
- `activation_goal_capture_prompt` → setzt learner_profiles.goal_capture_pending=true
- `activation_exam_date_capture_prompt` → learner_profiles.exam_date_capture_pending=true
- `activation_study_plan_generate` → v1 placeholder (echte Generator-Logik in Bridge 2 Welle)
- `activation_streak_initialize` → upsert streak_current=0
- `activation_first_minicheck_seed` → v1 placeholder

## SSOT-View
`v_learner_activation_state` (service_role only) klassifiziert jeden aktiven Grant in:
`NOT_STARTED | ONBOARDING | ACTIVATED | ENGAGED | AT_RISK (>14d inaktiv) | DORMANT (>30d inaktiv)`.

## SLA
`fn_detect_activation_sla_breach(10)` repariert breaches (Cron: `learner-activation-worker-2min` + `learner-activation-sla-5min`). Audit `auto_heal_log.action_type='activation_sla_check'`.

## Admin
`admin_get_activation_funnel()` (has_role gate) → summary + rescue_candidates. UI: `ActivationFunnelCard` im Heal-Cockpit.

## Limitations v1
- `study_plan_generate` + `first_minicheck_seed` sind Signal-Placeholder. Echte Lerndaten-Generierung kommt in Bridge 2 (Mastery → Exam Readiness).
- `streak` nutzt `learner_profiles.streak_current` (kein neues Streak-Aggregat — vermeidet Doppel-SSOT mit `user_learning_streaks`/`user_streaks` Legacy).
