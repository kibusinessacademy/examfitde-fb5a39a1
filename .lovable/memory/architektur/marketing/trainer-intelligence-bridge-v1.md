---
name: B2B Ausbildungsleiter Intelligence (Bridge 10)
description: Verwertet Population Intelligence (Bridge 9) produktnah. Org-Risk-Alerts, Trainer-NBA, Org-Readiness-Dashboard für Ausbildungsbetriebe. SSOT für B2B-Steuerung.
type: feature
---

# Bridge 10 — B2B Ausbildungsleiter Intelligence

**Prinzip**: Population-Snapshots (Bridge 9) → Risk-Detection → Org-Alerts + Trainer-Actions → Dismiss/Complete-Audit. Schließt die B2B-Loop von Daten zu Steuerung.

## SSOT-Tabellen
- **`organization_risk_alerts`** — alert_type (cohort_at_risk, inactive_learners, failure_pattern, low_readiness, exam_window_critical, intervention_ineffective), severity LOW/MEDIUM/HIGH/CRITICAL, status open/acknowledged/resolved/dismissed. Partial unique idx (org_id, COALESCE(curriculum_id,...), alert_type) WHERE status='open' verhindert Duplicate offene Alerts.
- **`trainer_action_recommendations`** — action_type (contact_learner, schedule_review, assign_rescue_track, escalate_to_manager, order_exam_simulation, adjust_curriculum_pace, celebrate_progress, custom), priority 0–100, target_learner_ids[], status open/done/dismissed. Optional FK auf alert_id.

## Views (service_role only)
- `v_org_exam_readiness_dashboard` — joint organization_learning_health × counts(open_alerts, open_actions). 90d Fenster.
- `v_trainer_next_best_actions` — open Actions + Alert-Severity/Type join. Filter status='open'.

## Admin-RPCs (SECURITY DEFINER + has_role)
- `admin_get_org_exam_readiness_dashboard(p_limit)`
- `admin_get_org_risk_alerts(p_limit, p_status)` — severity-sortiert
- `admin_get_trainer_next_best_actions(p_limit)` — priority DESC
- `admin_dismiss_trainer_action(p_action_id, p_reason)` — Audit `trainer_action_dismissed`
- `admin_complete_trainer_action(p_action_id, p_note)` — Audit `trainer_action_completed`

## Generator
- `fn_generate_trainer_risk_alerts()` SECURITY DEFINER (service_role):
  - Scannt latest `organization_learning_health` (14d) pro Org × Curriculum
  - 3 Detection-Regeln:
    1. **cohort_at_risk** wenn pct_at_risk ≥ 30 (CRITICAL ≥60, HIGH ≥45, sonst MEDIUM) → Action `assign_rescue_track` (P95/80/65)
    2. **low_readiness** wenn avg_readiness < 50 und total_learners ≥ 3 → Action `adjust_curriculum_pace` (P90 wenn <30, sonst P70)
    3. **inactive_learners** wenn active*2 < total und total ≥ 4 → Action `contact_learner` (P60)
  - Idempotent via ON CONFLICT (partial unique idx) UPDATE
  - Audit `trainer_risk_alerts_generated` in `auto_heal_log` mit jsonb-Details

## Cockpit
- `TrainerIntelligenceCard` im HealCockpit Diagnostics — 3 Sektionen + "Alerts regenerieren" Button + Erledigt/Verwerfen pro Action.

## Verkettung
Bridge 9 (Cohort+Population) → **Bridge 10 (Trainer Intelligence)** → Action ausgeführt → Outcome fließt zurück in Bridge 9 Snapshots → bessere Alerts.

## Vorgemerkt (nicht in v1)
- Cron daily für `fn_generate_trainer_risk_alerts`
- Echte Trainer-Rollen-RLS (statt admin-only) via organization_members + has_org_role
- Per-Trainer-Routing (trainer_user_id population aus org-memberships)
- Failure-Pattern Source (population_risk_clusters → org alerts)
- Exam-Window-Detection (curriculum.exam_dates Join)
- E-Mail-Benachrichtigung neuer CRITICAL-Alerts via heal-alert-notify-Pattern
- Ausbildungsleiter-Standalone-Dashboard `/admin/trainer-cockpit`
