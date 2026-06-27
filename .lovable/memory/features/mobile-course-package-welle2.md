---
name: MOBILE.COURSE.PACKAGE.OS.1 — Welle 2 (CI Build & Upload Skeletons)
description: GitHub Actions skeletons for Android AAB + iOS IPA/TestFlight builds, admin-only dispatch, callback status persistence. No production publishing.
type: feature
---

# Welle 2 — Build & Upload Skeletons

## Scope shipped
- Workflows
  - `.github/workflows/store-build-android.yml` — workflow_dispatch, dry_run default true, missing-secrets no-op, optional Google Play **Internal Track** upload (never production).
  - `.github/workflows/store-build-ios.yml` — workflow_dispatch, dry_run default true, macOS runner, optional **TestFlight** upload (no App Review submission).
- Edge Functions
  - `store-release-build-status` — verifies `STORE_RELEASE_STATUS_CALLBACK_SECRET` (constant-time), enforces stage/platform allowlists, strips secrets from metadata before persisting.
  - `store-release-dispatch-build` — admin-only (`assertAdmin`), writes `queued` row, optionally triggers `repository_dispatch` via `GITHUB_DISPATCH_TOKEN` (`GITHUB_DISPATCH_REPO`, `GITHUB_DISPATCH_REF=main`); falls back to `manual_required` when token absent.
- Persistence
  - `public.store_release_builds` (id, manifest_id, platform, workflow_run_id, commit_sha, build_number, stage, status, artifact_name, artifact_url, metadata_hash, error_code, dry_run, requested_by, created_at, updated_at). Admin read, service-role write, learners/public no access.
- Scripts
  - `scripts/store-build/validate-mobile-package.mjs` — pflichtdateien, secret-leaks, admin-routes, shadow-pfade, IAP-SSOT strings.
  - `scripts/store-build/build-android.mjs` — fetch-package | build | upload-internal (Internal Track only).
  - `scripts/store-build/build-ios.mjs` — fetch-package | build | upload-testflight (TestFlight only).
  - `scripts/store-build/_report.mjs` + `report-status.mjs` — Callback wrapper, fehler maskiert, sendet keine Secrets.
- Tests: `src/__tests__/store-release/welle2-build-skeleton.test.ts` (20 contract assertions).

## Required secrets (Workspace → Build Secrets)
Android: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.
Apple: `APPLE_TEAM_ID`, `APPLE_BUNDLE_ID`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_BASE64`, `IOS_CERTIFICATE_BASE64`, `IOS_CERTIFICATE_PASSWORD`, `IOS_PROVISIONING_PROFILE_BASE64`.
Dispatch / Callback: `STORE_RELEASE_STATUS_CALLBACK_SECRET` (auto-generated, runtime), `SUPABASE_URL` (build), and admin-managed `GITHUB_DISPATCH_TOKEN` + `GITHUB_DISPATCH_REPO`.

## Hard limits (do not change in this Cut)
- Android upload target is `internal` only — production is forbidden in workflow + tests.
- iOS upload target is TestFlight only — `submitForReview` / `appStoreVersionReleaseRequest` forbidden.
- No IAP / entitlement / lifecycle code touched.
- No store-status webhooks (Apple ASSN, Google RTDN) — owned by `IAP.STATUS.LIFECYCLE`.
- Secrets never persisted in `store_release_builds` (callback strips known keys, refuses PEM blocks).

## Open boundaries
- Real AAB/IPA build steps are stubs (`*.placeholder` artifacts). Replace with Gradle / xcodebuild calls when GitHub-hosted signing is exercised.
- Repository_dispatch path requires the user to add `GITHUB_DISPATCH_TOKEN` + `GITHUB_DISPATCH_REPO` runtime secrets; until then the cockpit shows `manual_required` and the workflow can be triggered from the Actions tab.
- Store Release Center UI build buttons land in Welle 2.1 (kept minimal in this Cut to avoid drift while real signing infra is wired up).
