---
name: Intervention Intelligence Bridge (Bridge 4) v1
description: Meta-orchestration over Commerce/Learning/Support loops — computes priorisierte Next-Best-Action pro Learner+Curriculum, retention_risk, exam_success_probability, dispatch in 5 neue Job-Types.
type: feature
---

# Bridge 4 — Intervention Intelligence / Next-Best-Action Engine

## SSOT
- Table `learner_intervention_state` (UNIQUE user_id+curriculum_id, expires 6h)
- Audit `learner_intervention_dispatch_log` (append-only)
- Views: `v_next_best_action`, `v_retention_risk`, `v_exam_success_probability` (locked: service_role only)

## Inputs (signal fusion)
- Readiness v2 (`learner_readiness_history` latest)
- Mastery decay (`user_competency_mastery` weak/struggling)
- Retention (`learner_profiles.last_activity_at` + churn_risk_score)
- Activation (`learner_course_grants.activated_at`)
- Days-to-exam pressure

## Decision tree → nba_action
activate_account → winback_campaign → retention_nudge → rescue_session → lf_gap_drill → weakness_training → exam_simulation → final_exam_prep → maintain_streak → continue_learning

## Priority Scoring (0-100)
critical retention=95 · CRITICAL=90 · high retention=80 · AT_RISK=75 · PARTIAL+exam_soon=70 · not_activated=65 · PARTIAL=55 · READY=30

## Job Types (registered)
- `compute_next_best_action` (idempotent, debounced 1 min)
- `trigger_learning_intervention`
- `trigger_retention_intervention` (auto-enqueues retention_nudge_v1 in email_delivery_queue)
- `generate_manager_alert` (B2B Ausbilder)
- `schedule_exam_simulation`

## Triggers
- `trg_readiness_to_nba` AFTER INSERT on `learner_readiness_history` → enqueue `compute_next_best_action` (idem `nba_recompute|<user>|<curr>|<minute>`)

## SLA
- `fn_detect_intervention_sla_breach(30)` flags priority≥70 states without dispatched_at after 30min
- Cron: intervention-worker 2min, sla-detector 10min

## Worker
- Edge function `intervention-intelligence-worker` — claims up to 25 jobs from `default` pool, filters handled types, completes/fails via `complete_job`/`fail_job`

## Cockpit
- `NextBestActionDistributionCard` in HealCockpit (Diagnostics tab) — counts pro action×retention_risk, avg priority/failure_risk/exam_success_prob, pending high-priority dispatches

## RPCs
- `fn_compute_next_best_action(user_id, curriculum_id)` SECURITY DEFINER (service_role)
- `admin_get_intervention_distribution()` SECURITY DEFINER (admin via has_role)

## Strategic position
Closes the loop: System reagiert → System steuert aktiv Prüfungserfolg. Erste Schicht für adaptive Lernsteuerung, Retention-Engine, Prüfungsprognose, B2B-Ausbildersteuerung.
