---
name: AI Tutor v2 as NBA-Executor (Bridge 8)
description: Tutor becomes empirical-NBA executor; SSOT-bound sessions, modes, audit, closes feedback loop into effectiveness ledger.
type: feature
---

# Bridge 8 — AI Tutor v2 als NBA-Executor

**Prinzip**: `v_empirical_next_best_action` → Tutor-Mode → SSOT-bound Session → Completion → mirror in `learner_intervention_dispatch_log` → Effectiveness-Ledger (Bridge 6) → Empirical Weighting (Bridge 7) → besserer Tutor.

## Bausteine
- **`tutor_intervention_sessions`**: append + update Table. Pflicht-SSOT-Binding via CHECK (mind. 1 von competency/lesson/blueprint/curriculum/exam_session). `readiness_delta` GENERATED. RLS: learner own + admin via has_role + service_role.
- **`v_tutor_nba_context`** (service_role): joint NBA-Decision + Mode-Mapping + aktueller Readiness/Verdict. Filter: decision ∈ {prefer, neutral, safety_fallback}.
- **Mode-Mapping**: rescue_session→coach, exam_simulation→examiner, lesson_recommend→explainer, tutor_session→coach, feedback_followup→feedback, oral_exam_practice→examiner, else→explainer.
- **`fn_start_tutor_intervention`**: SSOT-Gate + Empirical-Snapshot + Readiness-Snapshot + Insert + Audit `tutor_intervention_started`.
- **`fn_complete_tutor_intervention`**: Update + Readiness-After + best-effort Mirror in `learner_intervention_dispatch_log` (source=`tutor_v2`) + Audit `tutor_intervention_completed`. Trigger `trg_mirror_dispatch_to_events` aus Bridge 6 zieht den Lift automatisch in den Effectiveness-Ledger.
- **`admin_get_tutor_intervention_health`**: 14d Totals + by_mode + by_intervention (completion %, avg readiness delta).
- **UI**: `TutorInterventionHealthCard` im Heal-Cockpit Diagnostics-Tab neben Bridge-6/7-Cards.

## SSOT-Garantien
- Keine freien Tutor-Themen: Session benötigt mind. 1 Curriculum-/Blueprint-/Lesson-/Competency-/Exam-Session-Referenz.
- Empirische Felder werden zur Start-Zeit aus `v_empirical_next_best_action` snapshot — nicht live abhängig.
- Completion schreibt zwingend Audit + Mirror; Mirror-Fehler sind non-fatal (Session-State bleibt SSOT).

## Verkettung
Bridge 4 (NBA) → Bridge 7 (Empirical Weighting) → **Bridge 8 (Tutor Executor)** → Bridge 6 (Effectiveness Ledger via Mirror) → Bridge 7 (verbessert nächste Decision) → schließender Lernkreis.
