---
name: Runtime-Intelligence Cuts P0–P3 (2026-05-21)
description: Closed-loop Policy Feedback, E3e Bridging Completion, AI Observability Layer, Competency Weight/Difficulty SSOT. Wendepunkt zur AI-native Runtime.
type: feature
---

## P0 — Intervention Policy Registry + Outcome→Policy Feedback Loop
- **Table** `intervention_policies` (UNIQUE policy_key = intervention_type|reason_code; base_weight/current_weight/threshold_score/priority/enabled + last_sample_size/last_lift_pp).
- **View** `v_recommendation_policy_effectiveness` (90-Tage-Aggregation aus `recommendation_outcomes` JOIN `user_recommendations`, positive_rate_pct + avg_mastery_delta).
- **RPC** `fn_adjust_intervention_policy_weights(alpha=0.30, min_sample=10)` SECURITY DEFINER service_role → EMA-Update current_weight aus target = (positive_rate/50) + 2·max(0, mastery_delta), Audit `intervention_policy_weight_adjusted`.
- **RPC** `admin_get_intervention_policies()` (authenticated + has_role gate).
- **Seed**: alle bisherigen `(recommendation_type, reason_code)`-Kombinationen.
- **Audit-Contract**: `intervention_policy_weight_adjusted` (adjusted_count, alpha, min_sample).
- **Bedeutung**: Reinforcement-artige Lernschleife — Empfehlungen optimieren sich aus Outcomes.

## P1 — E3e Bridging Completion (Unreachable-Heal)
- **View** `v_unreachable_semantic_nodes` (all_nodes ⊖ in_bridge) klassifiziert node_role = contextual|product|pillar|spoke|other.
- **View** `v_e3e_bridge_health` (candidates_total, avg_bridge_score, materialised_total, unreachable_*).
- **RPC** `admin_get_e3e_bridge_health()`.
- **RPC** `admin_e3e_heal_unreachable_nodes(cap=50 max 100, min_score=20, dry_run=true)` materialisiert nur `pillar_contextual_bridge` deren target_url unreachable ist (dedup).
- **Audit-Contract**: `e3e_unreachable_heal_run` (inserted_count, scanned_candidates, dry_run, min_score, cap).

## P2 — AI Observability Layer
- **Table** `ai_observability_events` (event_kind ∈ {hallucination, grounding_miss, scope_violation, eval_drift, generation_rollback, citation_missing, schema_violation, quality_drop}, severity ∈ {info, warning, critical}, model, job_type, request_id, package_id, user_id, details).
- **View** `v_ai_model_health` (7d-Window, Counts + Rates pro Model × Job-Type).
- **RPC** `admin_get_ai_observability_summary(window_hours=168)`.
- **Audit-Contract**: `ai_observability_event_logged` (event_kind, model, severity).
- **Anschluss**: Edge-Functions (ai-generation-gateway, ai-tutor) inserten direkt via service_role; Cockpit-Card folgt.

## P3 — Competency Weight + Difficulty SSOT
- **Table** `competency_weights` (PK=competency_id, FK→competencies; exam_weight_pct 0–100, difficulty 1–5, expected_practice_minutes, prerequisite_competency_ids[]).
- **View** `v_curriculum_difficulty_map` (pro Curriculum: total_exam_weight_pct, avg_difficulty, hard/easy_competencies, total_expected_minutes).
- **RPC** `admin_get_competency_weights(curriculum_id?)`.
- **RPC** `admin_upsert_competency_weight(...)` mit Audit `competency_weight_upserted`.
- **Audit-Contract**: `competency_weight_upserted` (competency_id, exam_weight_pct, difficulty, source).
- **Bedeutung**: Voraussetzung für echtes adaptives Sequencing (P3-Stretch) + Difficulty-aware Scoring im Examiner.

## Linter
2287 (Baseline vor P0) → **2292** nach P3 (+5: 4 neue SECURITY-DEFINER-Views + 1 RLS-Tabelle ohne anon-Write — alle via SECURITY DEFINER RPC + service_role gated; konsistent mit etabliertem Pattern). Kein neuer Sicherheitsweg.

## Nächste Stufen (vorgemerkt, nicht in dieser Session)
- Cockpit-Cards: PolicyEffectivenessCard, E3eBridgeHealthCard, AiObservabilityCard, CompetencyWeightMapCard (lesen `admin_get_*` RPCs).
- Cron-Pulse `fn_adjust_intervention_policy_weights` täglich (nach NBA-Stabilitäts-Beobachtung).
- Wire-in: ai-generation-gateway + ai-tutor → `ai_observability_events` insert bei Hallucination/Grounding-Miss-Detection.
- NBA-Engine (Bridge 4) liest `intervention_policies.current_weight` als Prior beim Scoring.
- Backfill `competency_weights` aus blueprint_targets-Verteilung als initialer Auto-Seed.

## Rollback je Cut
- P0: DROP FUNCTION admin_get_intervention_policies, fn_adjust_intervention_policy_weights; DROP VIEW v_recommendation_policy_effectiveness; DROP TABLE intervention_policies.
- P1: DROP FUNCTION admin_e3e_heal_unreachable_nodes, admin_get_e3e_bridge_health; DROP VIEW v_e3e_bridge_health, v_unreachable_semantic_nodes.
- P2: DROP FUNCTION admin_get_ai_observability_summary; DROP VIEW v_ai_model_health; DROP TABLE ai_observability_events.
- P3: DROP FUNCTION admin_upsert_competency_weight, admin_get_competency_weights; DROP VIEW v_curriculum_difficulty_map; DROP TABLE competency_weights.
