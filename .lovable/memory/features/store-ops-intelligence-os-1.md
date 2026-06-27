---
name: STORE.OPS.INTELLIGENCE.OS.1
description: Deterministic, explainable decision-intelligence layer for ExamFit Mobile StoreOps — pure src/lib/storeOpsIntelligence/*, one admin-only edge function, append-only runs/findings, no publish/submit/rollout/IAP/entitlement changes.
type: feature
---

# STORE.OPS.INTELLIGENCE.OS.1

## Was
- Pure SSOT `src/lib/storeOpsIntelligence/` (contracts, intelligence-policy, analyzer, blocker-clustering, recommendation-engine, risk-score, confidence, projection, audit, index). No DB, no HTTP, no clock, no RNG, no fetch.
- Mirror under `supabase/functions/_shared/storeOpsIntelligence/` with explicit `.ts` imports.
- One admin-only edge function `analyze-store-ops`: loads `store_ops_batches`, `store_ops_batch_items`, `store_ops_kpi_snapshots`, `store_ops_autopilot_runs`, `store_ops_autopilot_actions`, runs the projector, persists run + findings, emits audit event `store_ops_intelligence_analyzed`.
- Persistence: `store_ops_intelligence_runs` and `store_ops_intelligence_findings`. Append-only via trigger `fn_store_ops_intel_no_mutation`. Admin read, service write only. No UPDATE, no DELETE.
- Admin UI: `StoreOpsIntelligenceCard` in `ReleaseOrchestrationCenter` (risk breakdown, confidence, top blockers/failures/trend, allow-listed recommendations with rationale + used_data + patterns). No publish/submit/rollout buttons.

## Intelligence Outputs
- top_blockers · top_failures · top_rejections · manual_interventions · recurring_risk_patterns
- action_success rates, mode_success rates, average_batch_runtime
- trend (kpi + autopilot risk)
- blocker_clusters (deterministic grouping)
- risk breakdown (technical / governance / operational / total, weighted 0.4/0.35/0.25)
- explainable confidence (sample_size 0.3, repeatability 0.25, success_rate 0.2, consistency 0.25)
- recommendations strictly from allow-list `RUN_SIMULATION_FIRST | REDUCE_BATCH_SIZE | ENABLE_MAINTENANCE_MODE | RECALCULATE_KPI | RISK_ACCEPTABLE | START_MANUAL_REVIEW | DISABLE_AUTOPILOT | RETRY_FAILED_ACTIONS | INVESTIGATE_RECURRING_BLOCKER | NO_ACTION_REQUIRED`. Every recommendation carries used_data, detected_patterns, risk, confidence, rationale.

## Hard Limits (frozen)
- No production publishing. No `submitForReview`, no rollout, no Store API release calls.
- No changes to IAP / entitlements / build pipeline / course content.
- No mutations of existing policies, gates, or Autopilot scope.
- No new write paths beyond `store_ops_intelligence_runs/findings` (append-only).
- Recommendations limited to allow-list; free-text AI recommendations forbidden.

## Tests
- `src/__tests__/store-ops-intelligence/store-ops-intelligence.test.ts` — analyzer, clustering, risk, confidence, recommendation policy, projection determinism (≥45 cases).
- `src/__tests__/store-ops-intelligence/no-publish-guard.test.ts` — scans SSOT, edge function, and UI for forbidden symbols, secrets, store API hosts, and ensures no new write paths.
