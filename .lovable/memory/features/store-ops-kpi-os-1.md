---
name: STORE.OPS.KPI.OS.1
description: Deterministic SSOT for ExamFit Mobile StoreOps KPIs — pure src/lib/storeOpsKpi/*, one admin-only edge function, append-only KPI snapshots, no publish/submit/IAP/entitlement changes.
type: feature
---

# STORE.OPS.KPI.OS.1

## Was
- Pure SSOT `src/lib/storeOpsKpi/` (contracts, metrics, risk, bottlenecks, projection, audit). Keine DB, kein HTTP, keine Uhr, keine RNG.
- Mirror unter `supabase/functions/_shared/storeOpsKpi/` mit `.ts`-Importen.
- Eine Edge Function: `evaluate-store-ops-kpi` (admin-only via `assertAdmin`, Audit in `security_events`). Lädt Manifest, Builds, Listings, Screenshots, Review-Gate, Candidates, Lifecycle-Events & -Feedback → reine Projection → persistiert Snapshot.
- Persistenz: `store_ops_kpi_snapshots` (admin read, service write, kein public/learner).
- Admin-UI: `StoreOpsHealthCard` im Release Orchestration Center (Health Score, Bottlenecks, Top Blockers, Top Rejection Reasons, Recommended Actions). Keine Publish-Buttons.

## KPIs (Summary)
total_manifests, review_ready_count, blocked_count, approved_count, rejected_count, build_success_rate, android_ready_count, ios_ready_count, missing_screenshots_count, missing_listing_count, missing_privacy_count, missing_support_count, average_review_score, candidate_invalidated_count, rollback_available_count, lifecycle_blocked_count, stale_candidates_count.

## Risk
- Pro Manifest: `classifyManifestRisk` → `low | medium | high | critical` aus fehlenden Assets, failed builds, Rejections, repeated rejection reasons, lifecycle-blocked, stale candidates, hash drift.
- Aggregat: `computeRiskDistribution` + `health_score` (gewichtet, mit Warn-Penalty + Build-Success-Faktor, 0–100).

## Bottlenecks
listing_bottleneck · screenshot_bottleneck · build_bottleneck · review_gate_bottleneck · lifecycle_bottleneck · rejection_bottleneck · stale_candidate_bottleneck — jeweils mit severity, affected_count, affected_manifest_ids, recommended_action.

## Hard Limits (frozen)
- Kein `submitForReview`, kein `publishRelease`, kein `rolloutRelease`, kein `production_track`.
- Keine Store-API-Aufrufe (Apple ASC / Google Play Publisher).
- Keine Änderung an IAP / `validate-iap-receipt` / `store_receipts` / `entitlements` / Build-Pipeline / Kursinhalten.
- KPI-Snapshots admin/service only.

## Tests
- `src/__tests__/store-ops-kpi/store-ops-kpi.test.ts` (Determinismus, Summary, Splits, Bottlenecks, Risk, Score, Warnings).
- `src/__tests__/store-ops-kpi/no-publish-guard.test.ts` scannt SSOT, Edge Function & UI auf Publishing-Symbole, Secrets, Direkt-Reads auf sensitive Tabellen und stellt sicher, dass die UI nur `evaluate-store-ops-kpi` aufruft.

## Folge
Folgender Cut: STORE.OPS.BATCH.OS.1.
