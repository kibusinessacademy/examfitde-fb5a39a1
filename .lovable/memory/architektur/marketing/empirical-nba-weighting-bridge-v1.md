---
name: Empirical NBA Weighting Bridge (Bridge 7) v1
description: NBA-Engine schaltet von regelbasiert auf empirisch um. intervention_effectiveness_scores fließt als Lift+Confidence in v_empirical_next_best_action. Safety-Fallbacks für rescue/exam/activate bei AT_RISK/CRITICAL.
type: feature
---

# Bridge 7 — Empirical NBA Weighting

## SSOT
- `nba_weighting_rules` (PK intervention_type): min_sample_for_weighting (15), min_lift_pp_prefer (2), block_lift_pp (-5), safety_fallback, weight_boost_pp_per_lift (1.0). Seed: rescue_session/exam_simulation/final_exam_prep/activate_account=safety_fallback=true.
- `v_empirical_next_best_action` (service_role only): JOIN v_next_best_action × intervention_effectiveness_scores (on intervention_type+risk_bucket, lf_code='all') × nba_weighting_rules → `decision ∈ {prefer, neutral, downrank, block, safety_fallback}` + `empirical_priority = rule_priority + ROUND(lift_pp × weight_boost)` (clamped 0-100).

## Decision Tree
- sample_size < min_sample → `neutral` (rule_priority unverändert)
- lift_pp ≤ block_lift_pp & retention_risk NOT IN (high,critical) & NOT safety_fallback → `block`
- lift_pp ≤ block_lift_pp & (safety_fallback OR risk in high/critical) → `safety_fallback` (Aktion bleibt, aber markiert)
- lift_pp ≥ min_lift_prefer → `prefer` (Priority erhöht)
- lift_pp < 0 → `downrank` (kein Hard-Block, aber sinkende Priorität)
- sonst → `neutral`

## RPCs
- `fn_compute_empirical_nba(user_id, curriculum_id)` SECURITY DEFINER (service_role) — schreibt `auto_heal_log` action_type=`empirical_nba_reweighted` mit rule_priority/empirical_priority/lift/decision/confidence_label. Aufruf später aus intervention-intelligence-worker statt heuristischer Priority.
- `admin_get_nba_weighting_health()` SECURITY DEFINER + `has_role('admin')` Gate → decisions_count, per_action (Top nach n, avg_lift_pp, avg_priority_shift), letzte 20 Audit-Rows.

## Cockpit
- `NbaWeightingHealthCard` in HealCockpit Diagnostics-Tab.

## Sicherheitsgarantien
- `safety_fallback=true` für rescue_session/exam_simulation/final_exam_prep/activate_account: bei negativem Lift werden sie nicht geblockt — Risiko-Lerner bekommen weiter rettende Maßnahmen.
- Confidence-Gate (n<15) → keine empirische Beeinflussung, Regel-Priorität bleibt SSOT.
- `block`-Entscheidungen sind hart audit-protokolliert (DSGVO/EU-AI-Act-Trail).

## Nächste Stufe (offen)
- Worker-Integration: `intervention-intelligence-worker` ruft `fn_compute_empirical_nba` und übernimmt `empirical_priority` statt `nba_priority` aus v_next_best_action.
- Per-LF-Weighting (aktuell nur lf_code='all' joinen — Phase 2 joint LF-spezifisch sobald genug Samples).
- Auto-Rule-Tuning: heuristische Anpassung der min_sample/block_lift Schwellen aus laufender Outcome-Verteilung.
