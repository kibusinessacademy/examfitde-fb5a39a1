---
name: MOBILE.COURSE.PACKAGE.OS.1 — Phase A Foundation
description: Per-course Capacitor mobile app bundler for Play Store (.aab) + Apple App Store. Generates source bundles + CI workflows; signing happens externally.
type: feature
---

# Mobile Course Package OS — Phase A

INVARIANT_OVERRIDE: BRIDGE.REQUIRED — reason: market-distribution-channel (Funnel/Architecture-Freeze overridden by user 2026-06-27).

## Scope shipped (Phase A)
- DB: `mobile_course_app_manifest` (1 row per Store-listable course, admin-only RLS).
- Edge fn: `mobile-course-package-build` — generates Capacitor source ZIP (config, package.json, CI workflows, store metadata DE/EN, IAP stub, LICENSE, README).
- Admin UI: `/admin/tools/mobile-bundle-builder` — CRUD manifest + one-click build.
- **SSOT-Guard:** Kursinhalt wird NICHT in das Bundle dupliziert — Bundle referenziert per signed URL den existierenden `course_package_outputs.export_zip_with_player`. Build-Skript (lokal/CI) lädt Content just-in-time nach `assets/course/`.

## Out of scope (Phase B/C)
- Receipt validation edge fn `validate-iap-receipt` (Apple StoreKit + Google Play).
- Doppelte Stripe⇄IAP-SKU-Sync.
- Reine White-Label Theme/Branding-Pipeline (Icons, Splash, Feature-Graphics per Beruf).
- Automatischer `npm install + cap sync + ./gradlew bundleRelease` in der Lovable Sandbox (UNMÖGLICH — Gradle/Xcode liegen extern).

## Plattform-Realität (nicht überschreibbar)
- Apple verlangt StoreKit IAP für digitale Kursinhalte. Stripe-Checkout ist NICHT App-konform innerhalb der App.
- Google Play verlangt Play Billing für digitale Inhalte.
- Lovable kann KEINE `.aab` signieren und KEINEN iOS-Archive erstellen → finaler Build extern (GitHub Actions oder lokal Mac).

## Required GitHub Secrets (Customer Setup)
Android: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
Apple: `APPLE_CERT_P12_BASE64`, `APPLE_CERT_PASSWORD`, `APPLE_BUNDLE_ID`, `APPLE_ISSUER_ID`, `APPLE_API_KEY_ID`, `APPLE_API_PRIVATE_KEY`.

## Operational Risk
193 verkaufsbereite Pakete × Per-Course-App = 386 Store-Listings. User-Entscheidung dokumentiert. Empfehlung Phase B: Hybrid (1 ExamFit-Shell + 3-5 Hero-Kurse).
