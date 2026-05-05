---
name: Launch Readiness SSOT v1
description: v_public_sellable_courses + admin_get_launch_readiness_dashboard + admin_get_launch_queue_health + admin_create_test_purchase_grant + public_trainer_available_curricula + LaunchReadinessDashboardCard + cleanup runner + SEO sellable guard + LAUNCH_READINESS.md
type: feature
---

## SSOT
- `v_public_sellable_courses` (REVOKED, service_role only) + `public_sellable_courses()` RPC für Shop/Frontend.
- `admin_get_launch_readiness_dashboard()` aggregiert: empty, sellable, pricing, queue health, trainer, blocked publishes — liefert `can_soft_launch` + `can_public_launch`.
- `admin_get_launch_queue_health()` für 6 verkaufsrelevante job_types.
- `admin_create_test_purchase_grant(course_id, email, reason)` schreibt grant via `grant_learner_course_access` + `auto_heal_log` (kein Stripe nötig im CI).
- `public_trainer_available_curricula(min=5)` für Trainer-Picker.

## UI
- `LaunchReadinessDashboardCard` in `/admin/ops/publish-blockers` ganz oben.

## Tooling
- `scripts/guards/empty-courses-cleanup-runner.mjs` (--dry-run / --demote-duplicates / --demote-no-curriculum / --backfill-candidates / --limit).
- `scripts/guards/seo-sellable-pages-guard.mjs` (failed wenn sellable Course ohne product_slug).
- `tests/e2e/purchase-grant-access.spec.ts` Playwright.
- CI workflow `.github/workflows/launch-readiness.yml`.

## Status Snapshot 2026-05-05
- empty=34, sellable=0 (kein public product hat aktiven Preis). Soft-Launch blockiert bis Stripe-Preise gesetzt sind.
