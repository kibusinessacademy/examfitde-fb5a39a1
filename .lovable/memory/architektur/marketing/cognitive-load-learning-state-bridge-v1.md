---
name: Cognitive Load & Learning State Intelligence Bridge v1 (Bridge 14)
description: SSOT für Lernzustand-Signale (Overload, Fatigue, Stabilität, Burnout) — strict learning-system-only, keine psychologische/medizinische Diagnostik. DSGVO/EU AI Act safe.
type: feature
---

## Scope
Übergang von „Was/Wann lernen?" → „In welcher Intensität — basierend auf Lernzustand?"

## SSOT Tables
- `learner_cognitive_state` — UNIQUE(user_id, curriculum_id). load_level (low|normal|elevated|overload), fatigue_score 0..100, stability_score 0..100, recommended_intensity (rest|light|normal|focused), last_signals jsonb.
- `learning_session_patterns` — pro Session: duration_minutes, accuracy_pct, accuracy_delta_pp, error_spike_count, time_of_day_bucket (morning|afternoon|evening|late_night), interventions_in_session.
- `fatigue_signals` — signal_type (cognitive_overload|intervention_fatigue|simulation_burnout|late_night_pattern|stability_decay|recovery_density_high|motivation_drop), severity, resolved_at.

RLS-on. service_role full. Learner SELECT own. Admin SELECT via has_role.

## Views (service_role only)
- `v_cognitive_overload_risk` — load IN (elevated,overload) ODER fatigue≥60 ODER stability≤40.
- `v_learning_stability_patterns` — 14d Aggregat: sessions, avg_accuracy, avg_delta_pp, error_spikes, declining_sessions.
- `v_recovery_burnout_signals` — ≥3 offene Burnout-Signals/7d pro user×curriculum.

## RPCs
- `fn_recompute_learner_cognitive_state(user, curriculum)` SECURITY DEFINER (service_role): empirisches Scoring aus 14d-Patterns + 7d-Signals. Bounded 0..100. Mapping:
  - fatigue≥75 OR stability≤25 → overload / rest
  - fatigue≥50 OR stability≤50 → elevated / light
  - 0 sessions → low / normal
  - sonst → normal / focused
  Audit `cognitive_state_recomputed` in auto_heal_log.
- `admin_get_cognitive_load_health()` (has_role): Cockpit-Summary mit state_counts, avg_fatigue/stability, open_signals_by_type/severity, burnout_clusters, sessions_14d.

## UI
`CognitiveLoadIntelligenceCard` im HealCockpit Diagnostics-Tab (nach AdaptivePathOrchestrationCard).
- KPI-Grid: avg fatigue/100, avg stability/100, burnout clusters, sessions 14d
- Load-Distribution Badges (low/normal/elevated/overload)
- Open-Signals nach Type + Severity Badges
- Footer-Disclaimer: SSOT-bounded · keine psychologische Diagnostik

## Hard Guardrails
- **Keine** psychologischen Labels, Gesundheitsprofile, medizinische Aussagen
- **Nur** lernbezogene Systemsignale (Accuracy-Delta, Error-Spikes, Session-Density, Time-of-Day, Intervention-Density)
- Signale sind **resolvable** (resolved_at)
- DSGVO/EU AI Act konform (kein automatisiertes high-risk decision-making über Personen)

## Strategischer Effekt
ExamFit kann jetzt Intensität/Sequenz/Tutor-Stil/Simulationstiming/Recovery-Dichte **adaptiv dimmen** wenn der Lernzustand instabil ist — innerhalb desselben Constraint-Governance-Framework wie Bridge 13 (Path-Orchestration nutzt `recommended_intensity` als zusätzlichen Step-Selector-Input).

## Offen (Nächste Stufen)
- Worker `cognitive-state-recompute-worker` triggert bei Session-Close.
- Detector-Jobs für fatigue_signals (separate Jobs pro signal_type, idempotent).
- Bridge-13 Path-Composer liest `recommended_intensity` und cap max_steps/intensity entsprechend.
- Auto-Tuning (Bridge 11) reweighted Intervention-Density bei chronischen overload-Mustern.
