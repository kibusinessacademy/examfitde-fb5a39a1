---
name: Temporal & Exam Window Intelligence Bridge v1 (Bridge 15)
description: SSOT für zeitbezogene Lernsteuerung — Exam-Window-Phase, Revision-Decay, Time-Pressure-Patterns. Transparent, explainable, keine Panik-Nudges.
type: feature
---

## Scope
Übergang von „Was/Wie/Reihenfolge/Intensität" → „Wie verändert sich der optimale Lernpfad über die Zeit bis zur Prüfung?"

## SSOT Tables
- `exam_window_states` — UNIQUE(user, curriculum). exam_date, days_to_exam, phase (unscheduled|early|build|sharpen|taper|final|post), recommended_focus (foundation|breadth|depth|simulation|review_only|rest|retro), intensity_recommendation (low|normal|elevated|peak|wind_down), signals jsonb. Learner darf eigenen exam_date selbst setzen (INSERT/UPDATE policy).
- `temporal_learning_patterns` — UNIQUE(user, curriculum, window_start). Weekly window: minutes_studied, sessions_count, simulations_done, new_lf_started, intensity_index, days_to_exam_at_window.
- `revision_cycles` — UNIQUE(user, curriculum, competency). last_reviewed_at, review_count, decay_score 0..100, next_review_due, spaced_priority, status (scheduled|due|overdue|satisfied|retired).

RLS-on. service_role full. Learner SELECT/UPSERT own (exam_date). Admin SELECT via has_role.

## Views (service_role only)
- `v_exam_countdown_risk` — exam_window_states mit days_to_exam ≤ 14 (Late-Phase-Pool).
- `v_revision_decay_patterns` — pro user×curriculum: tracked, overdue, due_now, due_soon (≤3d), avg_decay, max_decay.
- `v_time_pressure_effects` — late_phase_windows, late vs early intensity_avg, new_lf_in_final_week (Schlüsselsignal: spätes LF-Starten = Trainer-Alert-Kandidat).

## RPCs
- `fn_recompute_exam_window_state(user, curriculum)` SECURITY DEFINER (service_role): liest exam_date, berechnet days_to_exam, mappt Phase + Focus + Intensity:
  - days<0 → post / retro / low
  - ≤2 → final / rest / wind_down
  - ≤7 → taper / review_only / elevated
  - ≤21 → sharpen / simulation / peak
  - ≤60 → build / depth / elevated
  - >60 → early / breadth / normal
  - NULL → unscheduled / foundation / normal
  Signals jsonb mit days_to_exam, overdue_reviews, avg_decay, high_decay_warning (≥50), late_phase. Audit `exam_window_state_recomputed`.
- `admin_get_temporal_intelligence_health()` (has_role): phase_counts, focus_counts, countdown_risk_total, final_week_learners, late_new_lf_count, overdue_reviews_total, avg_decay, learners_with_exam_date.

## UI
`TemporalIntelligenceCard` im HealCockpit Diagnostics-Tab (nach CognitiveLoadIntelligenceCard).
- KPI-Grid: with-exam-date, final-week, overdue-reviews, avg-decay/100
- Phase-Distribution Badges (7 Phasen)
- Recommended-Focus-Distribution Badges
- Time-Pressure Signal-Box wenn late_new_lf_count > 0
- Disclaimer: transparente zeitbezogene Steuerung · keine Panik-Nudges

## Hard Guardrails
- **Keine** künstliche Urgency, **keine** Angst-Optimierung, **keine** Dark Patterns
- Phase-Mapping deterministisch + explainable (signals jsonb dokumentiert die Entscheidung)
- Learner kann eigenen exam_date jederzeit ändern (eigene RLS-Policy)
- Decay-Score gebunden 0..100, kein autonomes Re-Scheduling ohne Trigger

## Verkettung
- Bridge 13 Path-Composer kann `phase` + `recommended_focus` als zusätzlichen Step-Selector nutzen (z.B. phase='taper' → nur review_only steps).
- Bridge 14 Cognitive-Load kombiniert mit phase='final' → caps Intensity auf wind_down (no peak burst kurz vor Prüfung).
- Bridge 10 Trainer-Intelligence kann late_new_lf_count > 0 als Alert-Trigger nutzen.

## Strategischer Effekt
ExamFit versteht erstmals den **zeitlichen Verlauf** des optimalen Lernpfads. Phase + Focus geben jedem nachgelagerten Modul (NBA, Path, Tutor, Cognitive-Load) einen deterministischen Zeit-Kontext, der Recovery/Simulation/New-Content-Decisions sinnvoll macht.

## Offen (Nächste Stufen)
- `temporal-state-recompute-worker` (cron daily) zum Mass-Recompute aller geplanten exam_window_states.
- Decay-Score-Generator aus mastery-Daten + Zeit seit last_attempt.
- Revision-Cycle-Auto-Scheduling (spaced repetition Algorithmus mit phase-aware Caps).
- Learner-UI: Exam-Date-Picker + Phase-Indicator (transparent, ohne Countdown-Druck-Optik).
- Trainer-Alert-Bridge: late_new_lf_count > 0 → organization_risk_alerts.
