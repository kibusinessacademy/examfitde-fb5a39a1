---
name: STORE.PUBLISH.ORCHESTRATION.OS.1
description: Deterministic SSOT for ExamFit Mobile Store Release orchestration — pure src/lib/storeRelease/*, four admin-only edge functions, append-only timeline, no publish/submit/rollout.
type: feature
---

# STORE.PUBLISH.ORCHESTRATION.OS.1

## Was
- Pure SSOT-Modul `src/lib/storeRelease/` (contracts, releaseCandidate, releasePolicy, releaseState, releaseTimeline, releaseProjection, audit). Keine DB, kein HTTP, keine Uhr, keine RNG.
- Spiegelung unter `supabase/functions/_shared/storeRelease/` für die Edge Functions.
- Vier Edge Functions (alle admin-only via `assertAdmin`, Audit-Pflicht in `security_events`):
  - `create-store-release-candidate`
  - `invalidate-store-release-candidate`
  - `approve-store-release`
  - `export-store-submission-package`
- Persistenz: `store_release_candidates` (versioniert, Hash-Chain) und `store_release_timeline` (append-only, DB-Trigger blockt UPDATE/DELETE für nicht-service_role).
- Admin-UI: `ReleaseOrchestrationCenter` + `ReleaseOrchestrationCard` in `StoreReleaseCenterPage`. Vier Buttons: Create Candidate · Invalidate · Approve for Submission · Export Submission Package. Kein Publish/Submit/Rollout.

## Release States
`draft | candidate | review_ready | approved_for_submission | submitted_external | waiting_review | approved_store | rejected | cancelled | retired | released (reserviert)`

## Hash Governance
Jeder Candidate speichert `manifest_hash · listing_hash · package_hash · build_hash · review_hash · smoke_hash`. Drift → `invalidate_candidate` Next-Action und Policy-Blocker `HASH_DRIFT`.

## Submission Package Export
JSON-Bundle aus Manifest, Listings, Screenshots, Release Notes, Privacy/Support-URLs, Hashes, Review-Report, Review-Ready-Report, Known Limitations, Timeline. Defensiv ohne Secrets (`api_key`, `secret`, `signing_key` werden ausgestrippt). Der Mensch lädt das JSON herunter und reicht es manuell in App Store Connect / Play Console ein.

## Audit
`candidate_created · candidate_invalidated · candidate_approved · submission_exported · submission_cancelled` in `security_events` und Timeline.

## Tests
- `src/__tests__/store-release/release-orchestration.test.ts` (40+ Kontrakttests).
- `src/__tests__/store-release/release-orchestration-no-publish-guard.test.ts` verbietet `submitForReview`, `appStoreVersionReleaseRequest`, Production-Tracks, Apple/Google Store-APIs im Orchestrierungspfad.

## Hard Limits (frozen)
- Kein automatisches Production Publishing.
- Kein `submitForReview`.
- Kein automatisches Rollout.
- Keine Änderungen an IAP / Entitlements / Build-Pipeline.
- Nur Orchestrierung, Approval-State, Hash-Integrity, Timeline, Export. Der Mensch gibt die Freigabe.
