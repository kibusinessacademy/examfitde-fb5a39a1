---
name: OPS_GUARD non-building SSOT (Loop 2.1)
description: Single SSOT helper fn_is_job_type_whitelisted_for_non_building_package() konsolidiert Whitelist-Check (job_type_policies.can_run_when_not_building OR exempt_from_auto_cancel). ops_hygiene_cleanup war Drift-Quelle (failed Jobs ohne Policy-Check) — gepatcht. seo_sitemap_refresh + seo_internal_links als Policy ergänzt. fn_reap_non_building_pending_jobs + ops_cancel_pending_non_building_jobs honorieren bereits Policy.
type: feature
---

## Drift-Quelle
`ops_hygiene_cleanup` (separate function von ops_cancel_pending_non_building_jobs!) hat alle pending/processing Jobs auf nicht-building Paketen `failed` gesetzt — ohne `job_type_policies` zu konsultieren. Daher 88 OG, 100 Blog, 101 IndexNow Whitelist-Jobs gekillt vor Worker-Claim (started_at IS NULL).

## Fix
- `fn_is_job_type_whitelisted_for_non_building_package(text)` — STABLE SECURITY DEFINER SSOT. Liefert true wenn `can_run_when_not_building OR exempt_from_auto_cancel` in `job_type_policies`.
- `ops_hygiene_cleanup` filtert Kandidaten via `AND NOT public.fn_is_job_type_whitelisted_for_non_building_package(jq.job_type)`. Loggt zusätzlich `whitelisted_skipped` count + auto_heal_log run-audit.
- Neue Policies: `seo_sitemap_refresh`, `seo_internal_links` (can_run_when_not_building=true, exempt_from_auto_cancel=true, worker_pool=default).

## Retry-Backfill 2026-05-10
- 573 Jobs mit `:retry1` Suffix re-enqueued (88 OG + 100 Blog + 101 IndexNow + 142 sitemap + 142 links).
- meta.enqueue_source='loop_2_1_retry_backfill', retry_wave=1.
- Sofort nach Migration: 88 internal_links + 96 sitemap_refresh in `processing` (default-pool runner pickt sie sauber). 0 neue OPS_GUARD-Failures auf Retry-Wave.

## Akzeptanz
- [x] 0 neue `OPS_GUARD:NON_BUILDING_PACKAGE` für Growth-Jobs nach Migration
- [x] Retry-Jobs werden processing/pending statt failed
- [x] seo_sitemap_refresh + seo_internal_links policy-safe
- [x] Audit in auto_heal_log (`ops_hygiene_cleanup_run` mit whitelisted_skipped)
