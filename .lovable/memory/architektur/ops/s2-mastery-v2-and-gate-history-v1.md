---
name: S2 Mastery v2 + Gate Decision History + Auto-Pulse Verification
description: learner_competency_state SSOT + Mastery EWMA/Decay/Confidence + next_best_step engine; quality_gate_decision_history mit Input-Snapshot + 10min Cron; auto-pulse dryrun + 24h health-aggregat.
type: feature
---

# S2 — Adaptive Mastery + Gate History + Pulse Verification (2026-05-09)

## Track A — Quality Gate Decision History
- Tabelle `quality_gate_decision_history` (PK id, package_id, decision, prev_decision, score/badge/bronze_locked, report_status/rules_failed/rules_warned/report_signal, **inputs jsonb** snapshot {pending_default_pool, failure_rate_15m, reaper_churn_5m, lane, pool, gate_health}).
- RLS: nur admin SELECT, kein INSERT-Policy → mutiert nur via SECURITY DEFINER.
- `fn_snapshot_quality_gate_decisions()` (service_role): diff zur letzten History-Zeile pro Paket; INSERT nur bei Decision-Change. Audit `auto_heal_log.action_type='gate_decision_snapshot'`.
- Cron `gate-decision-snapshot-10min` (`*/10 * * * *`).
- `admin_record_gate_decisions_now()` (admin) → manueller Snapshot.
- `admin_get_gate_decision_history(p_package_id, p_limit)` (admin) → Drill-Down.
- UI: `QualityGateDecisionsCard` Sheet-Drawer per Paket-Klick + „Snapshot"-Button.

## Track B — Mastery v2 SSOT
- `learner_competency_state` (PK user_id+course_id+competency_id):
  - `mastery_score, confidence, decay_score, exam_readiness` (numeric(5,2) 0–100, CHECK)
  - `error_pattern jsonb` ({misconception_tags, recurring_question_ids, avg_response_ms, hint_usage_rate})
  - `samples_total, samples_correct, last_practice_at, last_event_type`
- `learner_mastery_event_log` (audit jeder Update-Quelle: minicheck/quiz/exam/tutor) inkl. mastery_before/after.
- RLS: Self+admin SELECT; **kein** INSERT/UPDATE-Policy → nur Service-Role/SECURITY DEFINER mutiert.
- `update_mastery_from_attempt(user, course, competency, correct, response_ms?, event_type, question_id?, misconception_tags?)`:
  - EWMA α=0.30
  - Confidence = 100 × (1 − exp(−n/8))
  - Decay = 100 × exp(−days_since_last_practice / 14)
  - exam_readiness = mastery × confidence/100 × decay/100
  - Caller-Check: `auth.uid() = p_user_id` ODER service_role
  - Audit-Insert in `learner_mastery_event_log`
- `v_learner_mastery_summary` per (user, course): avg_readiness, weakest_3, strongest_3, decay_alerts.
- `learner_get_mastery_summary(p_course_id)` (auth-only).
- `learner_next_best_step(p_course_id, p_limit=5)` (auth-only):
  - Action: REPAIR (<60) / DRILL (60–79) / REINFORCE (80–89) / CHALLENGE (≥90)
  - priority_score = (100 − readiness) + decay_boost (wenn decay<50) + low_evidence_boost (wenn samples<3)
  - reason: low_mastery | high_decay | low_evidence | consolidation_needed | enrichment

## Track D — Auto-Pulse Verification
- `fn_auto_recovery_pulse_decide_dryrun()` (service_role): identische Decision-Logik wie Live, kein claim_recovery_pulse, kein Logging — gibt `decision: 'would_pulse' | 'noop_*'` zurück.
- `admin_smoke_auto_recovery_pulse()` (admin) Wrapper.
- `admin_get_auto_recovery_pulse_health(p_window_hours=24)` (admin): aggregiert `auto_heal_log.auto_recovery_pulse_decide` per decision (count, pulsed_jobs_total, avg_burst_size, avg_oldest_min, avg_pending, last_at).
- UI: `RecoveryPulseHistoryCard` Health-Strip oben (24h) + bestehende Historie unten.

## Tests (vitest, anon-contract)
- `src/test/ops/dag-heal-and-alerts.test.ts`: +5 Burst-v2-Cases (failure_rate >20%, reaper>5, boundary clamp 100), +6 Refusal-Tests (Track A + D RPCs).
- `src/test/learner/mastery-v2.test.ts`: 4 Cases (summary/next_best_step refuse anon, update_mastery refuses cross-user, RLS read locked).

## SSOT-Regeln
- Mastery niemals client-side berechnen — immer via `update_mastery_from_attempt`.
- Gate-History nur via `fn_snapshot_quality_gate_decisions` füllen (kein Direct-INSERT).
- Pulse-Audit ist Pflicht: jede Pulse-Entscheidung loggt sich in `auto_heal_log` (auch noop).

## Out-of-Scope (Folge-Sprints)
- S2.1: Trigger-Verkabelung in echten Quiz/MiniCheck/Exam/Tutor-Flows.
- S2.2: Lernenden-UI (Adaptive-Path-Card, Mastery-Dashboard).
- S2.3: Decay-Reminder-Email-Sequenz (`email_delivery_queue` `mastery_decay_reminder`).
- Mastery-Gewichtung mit syllabus_weight + exam_date urgency_factor.

## Rollback
- Track A: DROP TABLE quality_gate_decision_history CASCADE; DROP FUNCTION fn_snapshot_quality_gate_decisions, admin_record_gate_decisions_now, admin_get_gate_decision_history; cron.unschedule('gate-decision-snapshot-10min').
- Track B: DROP TABLE learner_competency_state, learner_mastery_event_log CASCADE; DROP FUNCTION update_mastery_from_attempt, learner_next_best_step, learner_get_mastery_summary; DROP VIEW v_learner_mastery_summary.
- Track D: DROP FUNCTION fn_auto_recovery_pulse_decide_dryrun, admin_smoke_auto_recovery_pulse, admin_get_auto_recovery_pulse_health.
