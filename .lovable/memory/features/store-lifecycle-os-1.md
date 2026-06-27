---
name: STORE.LIFECYCLE.OS.1
description: Deterministic SSOT for ExamFit Mobile store-release lifecycle — pure src/lib/storeLifecycle/*, two admin-only edge functions, append-only events + feedback, no publish/submit/rollout.
type: feature
---

# STORE.LIFECYCLE.OS.1

## Was
- Pure SSOT `src/lib/storeLifecycle/` (contracts, lifecycleState, storeFeedback, rollbackPolicy, versionPolicy, lifecycleProjection, audit). Keine DB, kein HTTP, keine Uhr, keine RNG.
- Mirror unter `supabase/functions/_shared/storeLifecycle/`.
- Zwei Edge Functions (admin-only via `assertAdmin`, Audit in `security_events`):
  - `record-store-feedback` — persistiert ein manuelles Store-Feedback + appendet Lifecycle-Event.
  - `project-store-lifecycle` — read-only Projection über Candidates, Feedback, Events.
- Persistenz: `store_lifecycle_events` und `store_lifecycle_feedback` (beide append-only via Trigger; UPDATE/DELETE blocked außer service_role).
- Admin-UI: `StoreLifecycleCard` (Risk, Platform-State, Blocker, Warnings, Versionslinie, manuelles Feedback-Form).

## Lifecycle States
`not_submitted | submitted_manual | in_review | metadata_required | rejected | approved | ready_for_release | released_external | superseded | rollback_candidate | retired | blocked`

## Feedback Types
`apple_metadata_rejected · apple_binary_rejected · apple_approved · apple_waiting_for_review · apple_in_review · google_metadata_rejected · google_policy_rejected · google_approved · google_in_review · google_action_required · manual_note · unknown`

## Rollback Policy
Pure: schlägt einen früheren approved/released Candidate vor. Blockt bei `NO_PRIOR_APPROVED`, `MANIFEST_MISMATCH`, `PRODUCT_MISMATCH`, `CURRICULUM_MISMATCH`, `HASH_CHAIN_BROKEN`, fehlenden Snapshots, retired-Candidate. **Kein Store-API-Rollback.**

## Version Policy
- Metadata-only rejection → `same_version_metadata_fix`
- Binary rejected → `new_build_required`
- Manifest/Package-Hash drift → `new_candidate_required_for_hash_change`
- Listing/Build-Hash drift → eigene `new_listing_version` / `new_build_reference`
- Curriculum frozen wird durchgereicht; keine Curriculum-Mutation.

## Hard Limits (frozen)
- Kein `submitForReview`, kein `appStoreVersionReleaseRequest`, kein Production-Rollout.
- Keine Store-API-Aufrufe.
- Keine Änderung an IAP / Entitlements / Build-Pipeline / Kursinhalten.
- Append-only Tabellen; UPDATE/DELETE per Trigger blockiert.

## Tests
- `src/__tests__/store-lifecycle/lifecycle-os-1.test.ts` (Klassifikation, State-Machine, Rollback, Version, Projection).
- `src/__tests__/store-lifecycle/lifecycle-no-publish-guard.test.ts` scannt SSOT + Edge Functions auf verbotene Publishing-Symbole.
