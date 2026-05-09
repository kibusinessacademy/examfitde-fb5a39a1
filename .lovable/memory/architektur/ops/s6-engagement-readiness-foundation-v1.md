---
name: S6 W1 Engagement/Readiness Foundation
description: SSOT-Erweiterung für Engagement, Readiness-Erklärbarkeit, Oral-Memory, Risk-Events, Badge-Definitions
type: feature
---

# S6 — Engagement / Readiness / Oral / B2B (Welle 1: Foundation)

Plan-Doc: `.lovable/plan.md`. Recon bestätigte massiven SSOT-Bestand (Mastery, Readiness v1+v2, Daily, Oral, Badges, Retention, Profiles, Tutor, Conversion-Events) — daher KEIN Neuaufbau, nur Extension.

## Welle 1 (DONE 2026-05-09)

### ALTER (additiv)
- `readiness_snapshots` += `reason_codes jsonb`, `next_action_key text`, `version text default 'v2'`
- `learner_profiles` += `consistency_7d`, `consistency_30d`, `morning_evening_pattern`, `recovery_count`, `exam_target_date`, `exam_type`
- `daily_challenges` += `adaptive_strategy`, `weakness_targets uuid[]`, `expected_minutes`, `completion_minutes`, `streak_contribution`
- `oral_exam_sessions` += `kommunikationssicherheit_score`, `vollstaendigkeit_score`, `next_training_recs jsonb`
- `user_badges` += `level` (bronze/silber/gold/pruefungsreif), `awarded_by` (rule_key)

### Neue Tabellen (RLS aktiv)
- `badge_definitions` (PK badge_key) — SSOT für Badge-Vergaberegeln. authenticated read (active=true), admin write
- `engagement_daily_state` (PK user_id+day) — Lese-Cache, KEINE Wahrheit. user sees own
- `oral_session_memory` (UK user_id+competency_id+curriculum_id) — Aggregat aus oral_exam_turns
- `readiness_risk_events` + Enum `readiness_risk_type` (competency_critical|stagnation|decay|oral_unsicherheit|exam_proximity|consistency_drop)

### Architektur-Regeln
- Keine parallele Mastery- oder Streak-Logik. Erweitern nur über `update_learning_streak`, `recalculate_mastery`, `calculate_readiness_score_v2`.
- Engagement-Worker (W2) müssen S5b First-Heartbeat-Contract + S5d Burst v3 Caps einhalten.
- Tracking-Erweiterungen nutzen `conversion_events.package_id` Generated Column.
- B2B: aggregiert via MV `b2b_cohort_readiness` (W1.5 oder W2), Zugriff nur via SECURITY DEFINER + has_role.

## Audit
`auto_heal_log.action_type='s6_w1_foundation_migration'` (target_type=system, status=success).

## Nächste Wellen
- **W2** — Engines (`calculate_readiness_score_v3`, `update_learning_streak v2`, oral-session-evaluator, badge-evaluator, daily-engagement-runner)
- **W3** — Learner-UI (8 Komponenten + `/lernen/heute`)
- **W4** — Crons + CI-Guards + Healing-View
