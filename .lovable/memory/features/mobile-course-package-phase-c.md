---
name: MOBILE.COURSE.PACKAGE.OS.1 — Phase C (Hybrid Shell + Store Listings)
description: Release-ready Mobile-Bundle pro Kurs (Capacitor-Shell, Store-Listings DE/EN, IAP-Config gegen Phase-B-Dispatcher, CI-Workflows, Governance-Notes) ohne Content-Duplikation und ohne lokalen Unlock.
type: feature
---

# Phase C — Hybrid Shell + Store Listings

## SSOT-Pfad (unverändert)
Content: `course_package_outputs` → signed URL → Build-Step lädt JIT in `assets/course/`.
Access write: `validate-iap-receipt` → `verify-(ios|android)` → `store_receipts` → `create_store_entitlement` → `entitlements`.
Access read: `check_product_access_by_curriculum` → `useProductAccessByCurriculum`.

## Komponenten
- **Manifest-Erweiterung**: `mobile_course_app_manifest` (+curriculum_id, product_id, ios/android bundle/package, build_number, locales, store_skus, support/marketing URL, category, age_rating_hint, listing/release status, content_export_id).
- **Edge Function** `mobile-course-package-build` (Phase C): erzeugt
  - App Shell: `capacitor.config.ts`, `package.json`, `src/course-manifest.json`, `src/iap.config.ts`, `src/access-policy.ts`, `src/build-info.json`
  - Store Metadata: `store/app-store/listing.{de,en}.json`, `store/google-play/listing.{de,en}.json`, `store/privacy/README.md`, `store/review-notes.md`
  - Screenshots: `store/screenshots/README.md`, `required-sizes.json`, Slots phone/tablet/dark/light
  - CI: `android-release.yml`, `ios-release.yml`, `mobile-package-check.yml`
  - Governance: `RELEASE_CHECKLIST.md`, `SSOT_NOTES.md`, `IAP_NOTES.md`, `NO_SECRETS.md`, `KNOWN_LIMITATIONS.md`
- **Deterministische Hashes**: `listing_hash`, `iap_config_hash` (SHA-256) in `build-info.json` und API-Response.
- **Bundle-ID-Validierung**: reverse-DNS, separat für iOS/Android.
- **Admin-Cockpit**: `/admin/tools/mobile-bundle-builder` (Phase A) bleibt führend.

## Tests
- `src/__tests__/mobile-package/phase-c-contract.test.ts` — Pflichtdateien, IAP-SSOT-Referenzen, Cache-Keys, Bundle-Identität, Listing-Legalität ("kein offizieller Prüfungsträger"), CTA-Constraints, Build-Info-Felder, Bundle-ID-Validierung, Screenshot-Pflicht, Release-Checklist verweist auf Phase B.1.
- Bestehend: `src/__tests__/iap/iap-ssot-contract.test.ts`, `src/__tests__/guards/iap-shadow-paths.test.ts`.

## Guards (im Package eingebettet)
- CI `mobile-package-check.yml` blockt: Secrets (`service_role`, `sk_live`, `sk_test`, `APP_STORE_CONNECT`, `GOOGLE_APPLICATION_CREDENTIALS`, PEM-Header), Admin-Routen (`/admin/tools/mobile-iap-smoke`, `/admin/tools`, `/admin/`), Shadow-Identifier (`grantMobileAccess`, `unlockCourseLocally`, `createMobileEntitlement`, `validateReceiptClientSide`) und Storage-Keys (`mobile_access`, `course_unlocked`, `iap_entitlement`, `local_entitlement`).
- Verpflichtende Grep-Checks auf `validate-iap-receipt` und `check_product_access_by_curriculum` in `src/iap.config.ts`.

## Bekannte Grenze
- `IAP.STATUS.LIFECYCLE` — Refund/Expiry/Cancellation Webhooks von Apple/Google sind nicht Teil von Phase C. Wird im Bundle als `KNOWN_LIMITATIONS.md` referenziert und in der Release-Checklist gelistet.

## Nächster empfohlener Cut
- **IAP.STATUS.LIFECYCLE** — Apple App Store Server Notifications v2 + Google RTDN → `store_receipts` Statuswechsel → Entitlement Revoke via dedicated RPC, weiterhin ohne zweiten Lesepfad.
