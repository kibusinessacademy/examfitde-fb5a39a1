---
name: Predictive Scenario Simulation Bridge v1 (Bridge 16)
description: Vorausschauende, probabilistische Szenario-Projektionen mit Confidence-Bändern und explainable Drivers. Keine deterministischen Versprechen.
type: feature
---

## Scope
Übergang von „Bewertung des aktuellen Zustands" → „Simulation zukünftiger Lernentwicklungen".

## SSOT Tables
- `scenario_simulations` — UNIQUE(user, curriculum, scenario_key). scenario_type ∈ status_quo|recovery_choice|missed_sessions|added_simulations|intensification|lf_stabilization|custom, horizon_days 1-90, assumptions jsonb, status pending|running|completed|failed|superseded.
- `forecast_state_snapshots` — UNIQUE(scenario_id, horizon_day). Pro Szenario @ horizons {3,7,14,30}: readiness_projected/success_probability/fatigue/risk/stability/time_pressure (alle bounded), confidence_low/high Band, drivers jsonb.
- `path_projection_runs` — Run-Audit: model_version (v1.0-heuristic), input_signals jsonb, drivers, duration_ms, status ok|partial|failed.

RLS-on. service_role full. Learner SELECT own scenarios + snapshots (via JOIN-Policy). Admin SELECT via has_role.

## Views (service_role only)
- `v_readiness_forecasts` — Joined scenario+snapshot, completed scenarios only.
- `v_projected_failure_paths` — Szenarien mit MIN(success_probability) < 0.55.
- `v_intervention_projection_effects` — avg_prob pro scenario_type minus status_quo-baseline → delta_vs_status_quo (positive = wirksam).

## RPCs
- `fn_run_scenario_projection(user, curriculum, scenario_type, horizon_days, params)` SECURITY DEFINER (service_role): bounded heuristisches v1-Modell.
  - Liest aktuelle Signale aus `learner_cognitive_state` (fatigue, stability) + `exam_window_states` (days_to_exam), bounded Fallbacks.
  - Scenario-Deltas (deterministisch + transparent in code dokumentiert):
    - status_quo: +0.3 readiness/d, +0.5 fatigue/d
    - recovery_choice: +0.8/d, lift +4, +0.7 fatigue
    - missed_sessions: -0.6/d, conf-band 0.15
    - added_simulations: +0.5/d, lift +7, +1.2 fatigue
    - intensification: +0.6/d, lift +3, +2.0 fatigue, conf-band 0.15
    - lf_stabilization: +0.9/d, lift +6, +0.6 fatigue
  - Snapshots @ {3,7,14,30}d (jeweils ≤ horizon). All values bounded 0..100, prob 0..1.
  - success_probability = (readiness/100)*0.85 - (fatigue/200) + (stability/400), clamp [0,1].
  - confidence_band: ±0.10 default, ±0.15 für unsichere Szenarien.
  - drivers jsonb: base_fatigue, base_stability, days_to_exam, scenario_lift, daily_delta.
  - Audit `scenario_projection_run` in auto_heal_log.
- `admin_get_predictive_simulation_health()` (has_role): scenario_counts, status_counts, projected_failure_paths, avg_status_quo_prob, top_intervention_effects (6 best deltas), runs_24h, avg_duration_ms.

## UI
`PredictiveSimulationCard` im HealCockpit Diagnostics-Tab (nach TemporalIntelligenceCard).
- KPI-Grid: runs_24h, avg latency, avg status-quo probability %, projected failure-paths
- Scenario-Coverage Badges (Type-Counts)
- Status-Badges (completed/failed/pending)
- Top Intervention-Effects Table (scenario × horizon × Δpp × n)
- Disclaimer: probabilistisch · Confidence-Band · explainable Drivers · keine deterministischen Versprechen

## Hard Guardrails
- **Niemals** "Du wirst bestehen/durchfallen" — nur Wahrscheinlichkeiten mit Konfidenzband.
- **Bounded outputs**: alle Scores 0..100, Probability 0..1, Konfidenz 0..1.
- **Explainable**: jeder Snapshot enthält drivers[] (welche Faktoren beigetragen haben).
- **Model-Versioning**: model_version Pflicht; v1.0-heuristic ist deterministisch reproduzierbar (kein LLM, kein PII-Output).
- **service_role only** Execution — keine Learner-direkt-Calls.

## Verkettung
- Liest Bridge 14 (cognitive_load) + Bridge 15 (exam_window_states) als Input.
- Outputs feeden Bridge 13 (Path-Composer kann projected failure-paths als Re-Compute-Trigger nutzen).
- Bridge 10 (Trainer-Intelligence) kann v_projected_failure_paths als Alert-Quelle nutzen.
- Bridge 11 (Auto-Tuning) kann top_intervention_effects als empirische Validierung für Optimierungs-Vorschläge nutzen.

## Strategischer Effekt
ExamFit kann jetzt forward-looking adaptive Steuerung leisten: nicht nur „was passiert jetzt", sondern „welche Pfade wahrscheinlich wohin führen". Empirische Vergleichbarkeit zwischen Interventionen (status_quo als Baseline) macht NBA-Entscheidungen quantitativ vergleichbar.

## Offen (Nächste Stufen)
- `scenario-projection-worker` (cron) der für High-Risk-Learner täglich status_quo + 2 alternative Szenarien berechnet.
- ML-Modell v2 (calibrated logistic regression auf historische learner_readiness_history + outcomes).
- Trainer-UI: „Was-wäre-wenn"-Vergleich pro Lerner.
- Cohort-Projection (aggregierte Szenarien auf Org/Population-Ebene).
- Confidence-Calibration-Audit (Brier-Score vs. tatsächliche Outcomes nach Exam-Window).
