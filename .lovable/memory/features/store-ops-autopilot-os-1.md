---
name: STORE.OPS.AUTOPILOT.OS.1
description: Store Operations Autopilot — deterministic SSOT (src/lib/storeOpsAutopilot/*), 4 modes, allow-list of safe ops actions, 2 admin-only edge functions, append-only persistence. Never publishes, submits or rolls out.
type: feature
---

# STORE.OPS.AUTOPILOT.OS.1

## Was
- Pure SSOT `src/lib/storeOpsAutopilot/` (contracts, autopilotPolicy, autopilotPlanner, autopilotDecision, autopilotProjection, riskEvaluator, audit). Keine DB, kein HTTP, keine Uhr, keine RNG.
- Mirror unter `supabase/functions/_shared/storeOpsAutopilot/` mit `.ts`-Importen.
- Zwei Edge Functions (admin-only via `assertAdmin`, Audit in `security_events`):
  - `plan-store-autopilot` — lädt Snapshots, baut Plan, persistiert `store_ops_autopilot_runs` + `store_ops_autopilot_actions`. Unterstützt `simulation=true` (kein DB-Write).
  - `run-store-autopilot` — `decideExecution` Gate, dispatcht ausschließlich Allow-listed Aktionen an bestehende admin-only Edge Functions (`evaluate-store-review-ready`, `evaluate-store-ops-kpi`, `project-store-lifecycle`). Niemals Store API.
- Persistenz: `store_ops_autopilot_runs` und `store_ops_autopilot_actions` (append-only Trigger, admin read, service write).
- Admin-UI: `StoreOpsAutopilotCard` mit Mode-Select, "Plan erzeugen", "Simulation", "Safe Run", "Autopilot deaktivieren". Keine Publish/Submit/Rollout-Buttons.

## Modes
`disabled | recommend_only | safe_execute | maintenance`

## Allowed Actions
`run_review_gate · run_store_ops_kpi · run_lifecycle_projection · generate_listing · enqueue_screenshots · run_android_dry_build · run_ios_dry_build · create_release_candidate · export_submission_package · cleanup_stale_candidates · refresh_hashes · refresh_projection`

## Forbidden Actions (Policy-blocked)
`publish · submit_review · production_rollout · iap_change · entitlement_change · manual_feedback`

## Safe Execute Gates
Release-Candidate / Submission-Package nur wenn:
- Review-Ready, kein Hash-Drift, Android+iOS Build success, Listings approved, Screenshots vollständig, keine Lifecycle-Errors, keine offenen Batch-Errors.

## Risk
`evaluateRisk` aggregiert Gate-Blocker, Lifecycle-Errors, failed Builds, Listing-Status, fehlende Screenshots, Hash-Drift, Batch-Failures, KPI-Risk → 0–100 / `low|medium|high|critical`.

## Audit
`autopilot_planned · autopilot_started · autopilot_action_completed · autopilot_action_blocked · autopilot_finished` → `security_events`.

## Tests
- `src/__tests__/store-ops-autopilot/store-ops-autopilot.test.ts` (≥ 25 Tests: modes, forbidden actions, blockers, sequencing, determinism, projection, risk).
- `src/__tests__/store-ops-autopilot/no-publish-guard.test.ts` (UI/SSOT/EdgeFn frei von Publishing-Symbolen, Secrets, Store-APIs; SSOT frei von DB/HTTP/Uhr/RNG).

## Hard Limits (frozen)
- Kein Production Publishing, kein `submitForReview`, kein Rollout, keine Store-Release-API.
- Keine Änderungen an IAP / Entitlements / Build-Pipeline / Kursinhalten.
- Forbidden Actions werden im Policy-Layer abgewiesen, nicht im UI.
- Append-only Actions via DB-Trigger.
- Disabled-Mode → leerer Plan, kein Run.
- Recommend-only → niemals Execution.
- Safe-Execute → ausschließlich Allow-listed Aktionen mit applicability-Check.
