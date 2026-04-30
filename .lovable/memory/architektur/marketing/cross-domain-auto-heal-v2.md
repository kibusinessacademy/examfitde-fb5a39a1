---
name: Cross-Domain Auto-Heal & Tracking Hardening v2
description: track_conversion_event_v2 erweitert um p_package_id/p_persona/p_source_page mit Pflichtfeld-Validierung für strict events (22023). fn_platform_auto_heal heilt pricing+seo cross-domain (cron daily 04:03). admin_seo_backfill_missing_pages promotes drafts + scaffolds personas. Frontend SSOT: trackFunnel + emitFunnelEvent leiten package_id/persona/source_page als Top-Level-Felder. CI funnel-tracking-smoke.yml verifiziert beide Pfade (RPC + Edge) lehnen strict events ohne package_id ab.
type: feature
---

# Cross-Domain Auto-Heal v2 — 2026-04-30

## Components
- `track_conversion_event_v2(..., p_package_id, p_persona, p_source_page)` — Pflichtfeld-Validation (22023) für quiz_started/quiz_completed/lead_capture_submitted/checkout_complete. Backwards-compat: liest package_id auch aus metadata.
- `fn_platform_auto_heal(dry_run)` — direkte DB-Schreibrechte (kein admin-Gate), heilt pricing (high+low/ihk_ausbildung_standard) + seo (promote draft / scaffold personas). Cron `platform-auto-heal-daily` 03:04 UTC.
- `admin_seo_backfill_missing_pages(dry_run)` — admin-RPC für UI-trigger.
- Frontend: `trackFunnel` akzeptiert `package_id/persona/source_page` als TrackOptions; `emitFunnelEvent` reicht durch. Kein Bypass mehr — Server lehnt strict events ohne package_id ab.
- `scripts/funnel-tracking-smoke.mjs` + `.github/workflows/funnel-tracking-smoke.yml` (cron 47*) — verifiziert beide Pfade.

## Heal-Lauf 2026-04-30
- Pricing: 1 Paket (Fliesenleger, 24,90 €) → green.
- SEO: 9 Pages live (Fliesenleger 3 promoted + Straßenbauer/Immobiliardarlehensvermittler je 3 scaffolded) → green.
- Funnel: tracking_completeness bleibt initial rot bis neue Events mit package_id eintreffen (Frontend-Patch live).

## Cron-Schedule
- platform-auto-heal-daily: `3 4 * * *`
- funnel-tracking-smoke (CI): `47 * * * *`
- funnel-integrity-guard (CI): `19 * * * *`
- pricing-integrity-guard (CI): `23 * * * *`
