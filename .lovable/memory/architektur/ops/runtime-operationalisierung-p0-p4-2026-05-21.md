---
name: Runtime Operationalisierung P0–P4 (2026-05-21)
description: AI Eval Worker + Cron, Policy Mutation Watchdog, Sequencing Wire-In, Cockpit Cards, Regression Alerts.
type: feature
---

## P0 — AI Eval Worker
- Edge Function `supabase/functions/ai-eval-worker/index.ts` (service_role only)
  - scannt alle `ai_eval_datasets` (8 Stk.)
  - schickt **eine** Probe an `https://ai.gateway.lovable.dev/v1/chat/completions` (model: google/gemini-3-flash-preview, `max_tokens:4`) → ein Probe-Result pro Tick (kostenflach)
  - schreibt pro Dataset 3 Scores via `fn_record_ai_eval_run`: `availability`, `latency_score` (= 1 − latency/5000), `<kind>_heartbeat`
  - emittiert `ai_eval_worker_run` audit (datasets_scanned, runs_recorded, failures, duration_ms, probe_ok, probe_latency_ms)
- Cron `ai-eval-worker-6h` alle 6h (Cron-ID 278). Erweiterung pro Dataset-Kind = nächster Cut.

## P1 — Policy Mutation Watchdog
- RPC `fn_policy_mutation_watchdog(p_lookback_hours=24, p_min_delta_drop=-0.10, p_max_rollbacks=3)` (service_role only)
  - aggregiert je `policy_versions` (change_kind ∈ ema_adjust/bounded_capped/manual_override) das schlechteste `policy_effectiveness_windows.delta`
  - bei worst_delta ≤ −0.10 → `fn_rollback_policy_version(version_id)`; max 3 Rollbacks pro Lauf
  - Audit `policy_mutation_watchdog_decision` (versions_scanned, rollbacks_triggered, suspect_versions)
- Cron `policy-mutation-watchdog-hourly` `23 * * * *`.

## P2 — Adaptive Sequencing Wire-In
- RPC `learner_compute_and_get_sequence(p_curriculum_id)` (authenticated) — ruft `fn_compute_adaptive_sequence(auth.uid(), ...)` und liefert die zugehörige Decision-Row.
- RPC `learner_mark_sequence_applied(p_decision_id)` (authenticated, ownership-gated) — setzt `applied=true, applied_at=now()` + `adaptive_sequence_applied` audit.
- NBA/Tutor sind die designierten Consumer (Folgecut: Tutor-Pre-Step ruft `learner_compute_and_get_sequence` + Apply bei User-Acceptance).

## P3 — Cockpit Cards
- `src/features/admin/components/AiEvalRunsCard.tsx` — letzte 20 Eval-Runs (status, score_count, regression_flags).
- `src/features/admin/components/PolicyGovernanceCard.tsx` — letzte 20 Policy-Versionen (change_kind, audited_changes, capped_changes, max_delta).
- `src/features/admin/components/AdaptiveSequencingDecisionsCard.tsx` — Sequencing-Decisions 7d + Regression-Alerts.
- Karten sind noch nicht in eine Seite gemountet (Mount in Heal-/Growth-Cockpit = Folgecut, sobald die ersten Eval-Runs ein Bild liefern).

## P4 — Regression Alerts
- View `v_ai_eval_regression_alerts` (`ai_regression_windows` WHERE `regression_flag=true`) + RPC `admin_get_ai_eval_regression_alerts()` (has_role admin).
- Audit-Contract `ai_eval_regression_alert_emitted` registriert; konkretes Emit erfolgt im Cron-Erweiterungscut (post-tick Diff der regression_flags).

## Audit-Contracts (neu registriert)
- `ai_eval_worker_run` (datasets_scanned, runs_recorded, failures, duration_ms)
- `policy_mutation_watchdog_decision` (versions_scanned, rollbacks_triggered, suspect_versions)
- `adaptive_sequence_applied` (decision_id, user_id, curriculum_id, applied_at)
- `ai_eval_regression_alert_emitted` (metric, model, baseline_value, current_value, delta)

## Rollback
- DROP FUNCTION admin_get_ai_eval_regression_alerts, learner_mark_sequence_applied, learner_compute_and_get_sequence, fn_policy_mutation_watchdog;
- DROP VIEW v_ai_eval_regression_alerts;
- `SELECT cron.unschedule('ai-eval-worker-6h'); SELECT cron.unschedule('policy-mutation-watchdog-hourly');`
- Delete edge function `ai-eval-worker`.
