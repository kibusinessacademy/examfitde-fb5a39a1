---
name: STORE.OPS.BATCH.OS.1
description: Deterministic batch orchestration for ExamFit Mobile StoreOps — pure src/lib/storeOpsBatch/*, two admin-only edge functions, append-only items, allow-list of safe actions only.
type: feature
---

# STORE.OPS.BATCH.OS.1

## Was
- Pure SSOT `src/lib/storeOpsBatch/` (contracts, batchPolicy, batchPlan, batchState, batchProjection, audit). Keine DB, kein HTTP, keine Uhr, keine RNG.
- Mirror unter `supabase/functions/_shared/storeOpsBatch/` mit `.ts`-Importen.
- Zwei Edge Functions (admin-only via `assertAdmin`, Audit in `security_events`):
  - `plan-store-ops-batch` — lädt Snapshots, baut Plan, persistiert `store_ops_batches` + `store_ops_batch_items`.
  - `record-store-ops-batch-result` — append-only Outcome pro (manifest, action), re-projiziert State.
- Persistenz: `store_ops_batches` und `store_ops_batch_items` (append-only Trigger, admin read, service write).
- Admin-UI: `StoreOpsBatchCard` im Release Orchestration Center. Aktions- und Manifest-Picker, letzte Batches mit Status-Pills. Keine Publish-Buttons.

## States
`draft | planned | running | partially_completed | completed | blocked | cancelled`

## Allowed Actions
`generate_listing · enqueue_screenshots · run_android_dry_build · run_ios_dry_build · run_review_gate · run_kpi_snapshot · create_release_candidate · evaluate_lifecycle · export_submission_package`

## Forbidden Actions (Policy-blocked)
`publish · submit_for_review · production_rollout · store_release · iap_change · entitlement_change` — `filterAllowedActions` strippt sie und emitiert Warnings.

## Per-Manifest Blockers
`MANIFEST_INCOMPLETE · LIFECYCLE_BLOCKED · REVIEW_GATE_BLOCKED · BUILD_FAILED · HASH_DRIFT · ACTION_NOT_APPLICABLE · DEPENDENCY_NOT_READY`

## Audit
`store_ops_batch_planned · store_ops_batch_started · store_ops_batch_item_completed · store_ops_batch_completed · store_ops_batch_cancelled` → `security_events`.

## Tests
- `src/__tests__/store-ops-batch/store-ops-batch.test.ts` — Policy, Plan-Determinismus, Blockers, State-Machine, Projection.
- `src/__tests__/store-ops-batch/no-publish-guard.test.ts` — scannt SSOT, Edge Functions & UI auf Publishing-Symbole, Secrets und Store-APIs; stellt sicher, dass SSOT frei von DB/HTTP/Uhr/RNG ist.

## Hard Limits (frozen)
- Kein Production Publishing.
- Kein `submitForReview`, kein Rollout, keine Store-Release-API-Calls.
- Keine Änderungen an IAP / Entitlements / Build-Pipeline / Kursinhalten.
- Items sind append-only via DB-Trigger.
- Forbidden Actions werden im Plan-Layer abgewiesen, nicht im UI.
