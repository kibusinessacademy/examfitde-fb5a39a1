---
name: REVIEW.READY.GATE.OS.1
description: Deterministic SSOT gate for ExamFit Mobile Store-Review-Readiness — pure module src/lib/storeReviewReady/*, evaluate-store-review-ready edge fn, store_review_gate table, read-only Admin card.
type: feature
---

# REVIEW.READY.GATE.OS.1

## Was
- Pure SSOT-Modul `src/lib/storeReviewReady/` (contracts, reviewGate, rules, status, projection, audit) — keine DB, keine HTTP, keine Uhr, keine RNG, keine Fetches.
- Spiegelung unter `supabase/functions/_shared/storeReviewReady/` für die Edge Function.
- Edge Function `evaluate-store-review-ready` (admin-only via `assertAdmin`) lädt Manifest / Listings / Builds / Screenshots / IAP-Smoke aus der DB, ruft den deterministischen Gate auf, persistiert in `store_review_gate` (versioniert), schreibt Audit-Events in `security_events`.
- Tabelle `public.store_review_gate` mit RLS: Admin read, Service write, sonst nichts.
- Admin-UI: read-only Karte `ReviewReadyCard` in `StoreReleaseCenterPage` mit Score, State, Blockern, Warnings, Next-Actions, Android/iOS-Ampel. Einziger Button: "Neu prüfen". Kein Publish, kein Submit, kein Rollout.

## Review States
`draft | missing_assets | building | build_failed | qa_required | review_ready | blocked | released` (released reserviert).

## Hard Blocker (forcen `blocked`)
KNOWN_SECRET · ADMIN_ROUTE_FOUND · SHADOW_UNLOCK_FOUND · HASH_MISMATCH · PACKAGE_INVALID · LIFECYCLE_NOT_IMPLEMENTED.

## Scoring
Gewichtungen in `rules.ts` (Manifest 15 · Listing 15 · Screenshots 10 · Build 20 · Smoke 10 · Guards 10 · Tests 10 · Governance 5 · Known Limitations 5 = 100). Score ∈ [0..100].

## Audit
Edge Function emittiert `review_started` und je nach Outcome `review_ready` / `review_blocked` / `review_finished` (bzw. `review_failed` bei Exceptions) in `security_events`.

## Tests
- `src/__tests__/store-release/review-ready-gate.test.ts` (30+ Kontrakttests).
- `src/__tests__/store-release/review-ready-no-publish-guard.test.ts` (verbietet `submitForReview`, `appStoreVersionReleaseRequest`, Production-Tracks).

## Hard Limits (frozen)
- Keine Production-Publish-/Submit-/Release-APIs.
- Keine Änderung am IAP-Flow oder Entitlement-Layer.
- Keine Build-Pipeline-Änderung.
- Welle ist ausschließlich Governance/Read-only.
