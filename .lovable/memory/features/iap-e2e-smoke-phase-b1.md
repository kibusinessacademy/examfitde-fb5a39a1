---
name: IAP E2E Smoke & Regression Gate (Phase B.1)
description: Mobile-IAP SSOT — Dispatcher/Verifier/Receipt/Entitlement/Access-Pfad mit Admin-Harness, Contract- und Guard-Tests verifiziert.
type: feature
---

# Phase B.1 — IAP End-to-End Smoke

## SSOT-Pfad (unverändert)
Receipt → `validate-iap-receipt` → `verify-ios-receipt` | `verify-android-purchase` → `store_receipts` → `create_store_entitlement` → `entitlements` → `check_product_access_by_curriculum` → `useProductAccessByCurriculum` → Player-Unlock.

## Komponenten
- **Admin-Harness** `/admin/tools/mobile-iap-smoke` (`src/pages/admin/MobileIAPSmokePage.tsx`)
- **Smoke-Payloads** `src/lib/iap/smoke-payloads.ts` (Präfix `SMOKE-`)
- **Cleanup-RPC** `public.cleanup_iap_smoke_artifacts(uuid)` (SECURITY DEFINER, admin-only, self-only, audit via `fn_emit_audit`)
- **Contract-Tests** `src/__tests__/iap/iap-ssot-contract.test.ts`
- **Guard-Tests** `src/__tests__/guards/iap-shadow-paths.test.ts`
- **Playwright** `tests/e2e/mobile-iap-smoke.spec.ts` (skip ohne Admin-Creds)

## Cases
- iOS happy / Android happy / Duplicate / Invalid → grün
- Expired/Refunded → TODO `[IAP.STATUS.LIFECYCLE]`, Blocker-Code `not_implemented_status_lifecycle`

## Harte Verbote (Guard-Tests)
- Keine Client-Reads/Writes auf `entitlements`, `store_receipts` außerhalb `src/pages/admin/**` und `src/components/admin/**`
- Keine Identifier `grantMobileAccess`, `unlockCourseLocally`, `createMobileEntitlement`, `validateReceiptClientSide`
- Keine Storage-Keys `mobile_access`, `course_unlocked`, `iap_entitlement`, `local_entitlement`

## Seiten-Findings
- `useIAPReceiptValidation`: Invalidations-Key war `product-access-by-curriculum`, real lautet er `product-access-curriculum`. Beide werden jetzt invalidiert (Back-Compat).
- Bestehende Verifier setzen `environment='production'` hart; Sandbox-Markierung läuft über `SMOKE-`-Präfix im `transaction_id`. Aufräumen über Cleanup-RPC.

## Offene Store-Sandbox-Grenzen
- Keine Live-Calls an Apple App Store Server API / Google Play Developer API in dieser Phase.
- Status-Lifecycle (expired/refunded/cancelled) erfordert separate Phase (`IAP.STATUS.LIFECYCLE`).
