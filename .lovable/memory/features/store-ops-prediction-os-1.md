---
name: STORE.OPS.PREDICTION.OS.1
description: Deterministic, explainable predictive risk & outcome engine for ExamFit Mobile StoreOps. Pure src/lib/storeOpsPrediction/*, one admin-only edge function, append-only runs/results. No publish, submit, rollout, IAP, entitlement, or policy mutations.
type: feature
---

# STORE.OPS.PREDICTION.OS.1

## Was
- Pure SSOT `src/lib/storeOpsPrediction/` (contracts, prediction-policy, predictor, outcome-model, blocker-forecast, duration-estimator, confidence, projection, audit, index). No DB, HTTP, clock, RNG, or fetch.
- Mirror under `supabase/functions/_shared/storeOpsPrediction/` with explicit `.ts` imports.
- One admin-only edge function `predict-store-ops`: validates planned operation against forbidden-action policy, loads SSOT snapshots from `store_ops_batches`, `store_ops_batch_items`, `store_ops_kpi_snapshots`, `store_ops_autopilot_runs`, `store_ops_autopilot_actions`, `store_ops_intelligence_runs`, `store_ops_intelligence_findings`, runs `projectPrediction`, persists run + per-finding results, emits `security_events.event_type='store_ops_prediction_completed'`.
- Persistence: `store_ops_prediction_runs` and `store_ops_prediction_results`. Append-only via trigger `fn_store_ops_prediction_no_mutation`. Admin read, service write only. No UPDATE, no DELETE.
- Admin UI: `StoreOpsPredictionCard` integrated into `ReleaseOrchestrationCenter`. Inputs: operation_key, expected_manifest_count, allow-listed action_types CSV. Outputs: success probability, risk traffic-light + 5 components, expected duration, expected blockers/rejections, queue load factor, manual interventions, confidence, influence factors, warnings, run history. No execute / publish / submit / rollout buttons.

## Prediction Outputs
- outcome (success probability, expected succeeded/failed/blocked, baseline_used)
- duration forecast (per action_type, total seconds)
- queue load forecast (planned vs. recent average batch)
- manual intervention forecast
- blocker forecast (historical rate × planned size)
- rejection forecast (from KPI top_rejection_reasons)
- action baselines (per action_type rates and average durations)
- risk breakdown across 5 dimensions: technical (30 %), governance (25 %), operational (20 %), data_quality (10 %), capacity (15 %)
- confidence: sample_size 0.25, pattern_consistency 0.2, data_quality 0.15, repeatability 0.2, historical_stability 0.2
- explainability: used_data, similar_runs (batches, autopilot_runs, intelligence_runs), detected_patterns, influence_factors, rationale

## Hard Limits (frozen)
- No production publishing. No `submitForReview`, no rollout, no Store API release calls.
- No changes to IAP / entitlements / build pipeline / course content.
- No mutations of existing policies, gates, Autopilot scope, or Intelligence outputs.
- No new write paths beyond `store_ops_prediction_runs/results` (append-only).
- Planned operations carrying any forbidden action token (publish, submit_for_review, production_rollout, approve, bypass_review, modify_policy, modify_gate, extend_autopilot) are rejected by `assertPlannedOperation` before any read.

## Tests
- `src/__tests__/store-ops-prediction/store-ops-prediction.test.ts` — baselines, outcome model, blocker/rejection/manual forecasts, duration, queue load, risk, confidence, explainability, projection determinism, regressions vs. KPI / batch / autopilot / intelligence inputs (≥ 50 cases).
- `src/__tests__/store-ops-prediction/no-publish-guard.test.ts` — scans SSOT, edge function, and UI for forbidden symbols, secrets, store API hosts; verifies append-only edge writes; verifies UI exposes no publish/submit/rollout/execute buttons.
