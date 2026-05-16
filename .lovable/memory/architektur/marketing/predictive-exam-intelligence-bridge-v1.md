---
name: Predictive Exam Intelligence Bridge (Bridge 5) v1
description: SSOT für statistische Erfolgs-/Misserfolgs-Treiber pro Curriculum. Outcome-Ledger + Path-Patterns + Driver-View als Daten-Moat für Bestehensprognose.
type: feature
---

# Bridge 5 — Predictive Exam Intelligence

## SSOT
- `exam_outcome_events` — append-only Outcome-Ledger (pass/fail/partial), self+admin RLS-read, service_role-write
- `learner_path_patterns` — aggregierte Lern-/Sim-/Tutor-Pfad-Signaturen mit `pass_rate` (GENERATED) + `success_correlation`
- View `v_exam_success_drivers` (service_role only) — pro Curriculum: attempts/passes/fails/pass_rate, avg_readiness_at_attempt, avg_days_since_activation, top_failure_drivers (jsonb, Top 10)

## Capture
- Trigger `trg_exam_session_to_outcome` AFTER INSERT OR UPDATE OF finished_at, passed ON `exam_sessions`
  - Schreibt `source='exam_sim'`, outcome aus `passed`, snapshot `readiness_score`/`verdict` aus letzter `learner_readiness_history`, `days_since_activation` aus `learner_course_grants.activated_at`

## Admin RPC
- `admin_get_exam_success_drivers()` SECURITY DEFINER + has_role('admin') gate → Top 50 Curricula nach attempts

## Cockpit
- `ExamSuccessDriversCard` in HealCockpit (Diagnostics tab)

## Strategischer Wert
- Daten-Moat: welche Kompetenzen korrelieren mit Durchfallen (`top_failure_drivers.fail_rate_when_weak`)
- Future: feeds NBA-Engine (Bridge 4) mit empirischen Gewichten statt heuristischen Schwellen
- B2B: Ausbildungsleiter-Cockpit kann gefährdete Cluster identifizieren (Bridge 6+ Ausbaustufe)
