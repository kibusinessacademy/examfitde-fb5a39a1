---
name: Adaptive Intervention Effectiveness Bridge (Bridge 6) v1
description: Empirische Wirksamkeitsmessung pro Intervention × Risiko × LF. Lift in Prozentpunkten vs. Baseline-Pass-Rate. NBA-Engine wird von regelbasiert → empirisch optimiert.
type: feature
---

# Bridge 6 — Adaptive Intervention Effectiveness Engine

## SSOT
- `learner_intervention_events` — append-only Ledger (user×curr×type×risk×lf, readiness_before/after, exam_outcome). Self+Admin RLS-read, service_role-write.
- `intervention_effectiveness_scores` — aggregierter UPSERT pro (intervention_type, risk_bucket, lf_code) mit `pass_rate_lift_pp` vs. globaler Baseline + `confidence_label` (n≥50 high, ≥15 medium).
- `learner_recovery_paths` — sequenzielle Intervention-Pfade von at-risk → ready (für Pattern-Mining).

## Capture
- Trigger `trg_mirror_dispatch_to_events` auf `learner_intervention_dispatch_log` → spiegelt jeden Dispatch in das Ledger; lädt aktuellen `retention_risk` (state) + letzte `readiness_score` als `readiness_before`.
- `readiness_after` + `exam_outcome` werden später durch nachgelagerte Jobs/Trigger gefüllt (Outcome-Window aus `learner_readiness_history` + `exam_outcome_events`).

## Views (service_role only)
- `v_intervention_effectiveness` — type×risk avg Δreadiness + pass_rate + pending_outcome
- `v_best_recovery_actions` — Top-Δreadiness pro type×risk (n≥5)
- `v_intervention_failure_patterns` — fail_rate_pct DESC pro type×risk (n≥5)

## RPCs
- `fn_recompute_intervention_effectiveness()` SECURITY DEFINER (service_role) — idempotenter UPSERT in `intervention_effectiveness_scores`, Audit in `auto_heal_log` (`action_type='intervention_effectiveness_recompute'`).
- `admin_get_intervention_effectiveness()` SECURITY DEFINER + `has_role('admin')` Gate — Top 100 nach lift_pp DESC.

## Cockpit
- `InterventionEffectivenessCard` in HealCockpit (Diagnostics-Tab).

## Strategischer Wert
- NBA-Engine (Bridge 4) kann jetzt von heuristischen Prioritäten auf empirische Gewichte umschalten: bei Profil X erhöht Intervention Y die Pass-Wahrscheinlichkeit statistisch am stärksten.
- Explainability: `pass_rate_lift_pp` + `confidence_label` + `sample_size` — DSGVO-/EU-AI-Act-/B2B-tauglich.
- Failure-Patterns (`v_intervention_failure_patterns`) decken kontraproduktive Maßnahmen auf (z. B. lange Sessions kurz vor Prüfung).

## Nächste Stufe (vorgemerkt, nicht in v1)
- Cron `fn_recompute_intervention_effectiveness` täglich
- Outcome-Window-Worker (readiness_after nach 7 Tagen, exam_outcome nach erster Simulation/Prüfung)
- NBA-Re-Weighting RPC, das `intervention_effectiveness_scores` als Prior in `fn_compute_next_best_action` einfließen lässt.
