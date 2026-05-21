---
name: Control-Plane Mega-Layers L1–L3 (2026-05-21)
description: Policy Governance Runtime + AI Evaluation Engine + Adaptive Sequencing Engine — Service-role internal-state-update pattern für selbstoptimierende Lernplattform.
type: feature
---

## Service-Role Internal-State-Update Pattern
Adaptive Mutations an SSOT-Tabellen (intervention_policies, ai_eval_*, learner_sequencing_decisions) laufen ausschließlich über SECURITY DEFINER RPCs mit `GRANT EXECUTE … TO service_role` und `REVOKE FROM PUBLIC,anon,authenticated`. Jeder Write erzeugt eine fn_emit_audit-Zeile mit registriertem action_type. Direct UPDATE auf diese Tabellen ist nur für rohe Wartung erlaubt.

## L1 — Policy Governance Runtime
- **policy_versions** (version_no, parent_version_id, change_kind ∈ {seed, ema_adjust, manual_override, rollback, disable, enable}, reason, created_by).
- **policy_change_audits** (version_id, policy_key, before_weight, after_weight, GENERATED delta, sample_size, positive_rate_pct, source ∈ {bounded_ema, bounded_capped, rollback}).
- **policy_effectiveness_windows** (version × metric vor/nach mit GENERATED delta).
- **policy_rollback_snapshots** (jsonb-Vollabbild von intervention_policies pro Version).
- **fn_apply_policy_mutation_bounded(alpha=0.30, min_sample=10, max_delta=0.50, min_confidence_pct=55.0, reason)** — service_role only. Erzeugt Version, snapshot, EMA-Update mit max_delta-Cap, ein Audit-Row pro Policy, fn_emit_audit('policy_mutation_applied').
- **fn_rollback_policy_version(version_id)** — service_role only. Erzeugt neue rollback-Version, schreibt Snapshot zurück.
- **admin_get_policy_governance_summary(limit=20)** — Versions-Übersicht (changes, total/max delta, capped count).
- Audit: `policy_mutation_applied` (required_keys: version_id, adjusted_count, capped_count, alpha, max_delta, min_sample, min_confidence_pct, reason).
- **Replacement-Pflicht**: adaptive Adjust-Crons müssen `fn_apply_policy_mutation_bounded` aufrufen — nicht mehr `fn_adjust_intervention_policy_weights` (Legacy bleibt für Smoke).

## L2 — AI Evaluation Engine
- **ai_eval_datasets** (dataset_key UNIQUE, kind ∈ {tutor_accuracy, grounding_coverage, oral_realism, recommendation_lift, difficulty_calibration, sequencing_quality, intervention_effectiveness, semantic_grounding}). Seed: 8 Datasets `*_v1`.
- **ai_eval_runs** (dataset_id, model, job_type, status ∈ {pending, running, succeeded, failed}, started/finished_at).
- **ai_eval_scores** (run_id, metric, value, ci_low/high, sample_size).
- **ai_regression_windows** (UNIQUE metric+model: baseline_value, current_value, GENERATED delta, regression_flag).
- **fn_record_ai_eval_run(dataset_key, model, job_type, scores jsonb[], status='succeeded', notes, regression_threshold=-0.05)** — service_role only. Atomar: run anlegen, alle scores inserten, regression_windows per (metric, model) upserten + regression_flag berechnen, fn_emit_audit.
- **admin_get_ai_eval_summary(limit=30)** — last runs mit score_count + regression_flags.
- Audit: `ai_eval_run_recorded` (required: run_id, dataset_key, model, job_type, score_count, status).
- **Wire-in (Folge-Cut)**: ai-generation-gateway, ai-tutor, oral-exam-runner, sequencing-worker rufen `fn_record_ai_eval_run` aus dedizierten eval-Edge-Functions.

## L3 — Adaptive Sequencing Engine
- **adaptive_sequencing_policies** (rule_key UNIQUE, condition/action_jsonb, priority, weight, enabled). Seed 5 Rules: rescue_high_risk(90), recovery_high_difficulty_low_readiness(80), exam_simulation_high_readiness(70), deprioritize_low_weight_high_mastery(40), continue_default(10).
- **learner_sequencing_decisions** (user, curriculum, rule_key, recommended_action, payload, applied) — RLS self + admin read, service write.
- **fn_compute_adaptive_sequence(user_id, curriculum_id)** — service_role only. Liest learner_readiness_history.latest + competency_weights aggregate (avg_difficulty, avg_exam_weight_pct), evaluiert Rules in priority-order (first-match), schreibt Decision, fn_emit_audit.
- **admin_get_sequencing_decisions_summary(window_days=7)** — pro rule_key: decisions/applied/distinct_users/last.
- Audit: `adaptive_sequence_computed` (decision_id, user_id, curriculum_id, rule_key, recommended_action).
- **Wire-in (Folge-Cut)**: Tutor-Pre-Step und NBA-Engine rufen fn_compute_adaptive_sequence; UI markiert applied=true bei Action-Acceptance.

## Linter Baseline
Vor L1: 2292 → Nach L3: 2295 (+3, alle pre-existing INFO/ERROR-Klassen: RLS-no-policy + Security-Definer-View). Keine neuen Sicherheitspfade — alle Tabellen RLS-on, neue Funktionen service_role-gated.

## Nächste Cuts (vorgemerkt)
- Cron `policy-mutation-daily` ruft `fn_apply_policy_mutation_bounded`; Anomaly-Detector vergleicht aufeinanderfolgende Versionen + ruft fn_rollback_policy_version bei regression_flag.
- Eval-Worker Edge-Function `ai-eval-runner` produziert Datasets nach Schedule (weekly) + schreibt via fn_record_ai_eval_run.
- Sequencing-Worker konsumiert Outbox aus learner_intervention_state → fn_compute_adaptive_sequence + Apply-Pfad.
- Cockpit-Cards: PolicyGovernanceCard, AiEvalRunsCard, AdaptiveSequencingDecisionsCard.

## Rollback je Layer
- L1: DROP FUNCTION admin_get_policy_governance_summary, fn_rollback_policy_version, fn_apply_policy_mutation_bounded; DROP TABLE policy_rollback_snapshots, policy_effectiveness_windows, policy_change_audits, policy_versions CASCADE.
- L2: DROP FUNCTION admin_get_ai_eval_summary, fn_record_ai_eval_run; DROP TABLE ai_regression_windows, ai_eval_scores, ai_eval_runs, ai_eval_datasets CASCADE.
- L3: DROP FUNCTION admin_get_sequencing_decisions_summary, fn_compute_adaptive_sequence; DROP TABLE learner_sequencing_decisions, adaptive_sequencing_policies CASCADE.
