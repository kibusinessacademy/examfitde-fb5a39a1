---
name: IndexNow Drain + Backfill + Dashboard v1
description: Root-Cause Drain-Drift in seo-submit-indexnow + neue Actions drain_pending/backfill_sitemap + /admin/seo/indexnow Dashboard + RPC admin_get_indexnow_status_summary.
type: feature
---

## Root-Cause (gefunden 2026-05-25)
`post-publish-growth-worker.handleSeoIndexNowSubmit` schreibt seit Wave 2 Loop 2 Pending-Rows mit `source_type='course_package'` in `seo_submission_logs`. Der Cron `seo-indexnow-submit-30min` rief `seo-submit-indexnow` mit Body `{drain:true}` auf — die Edge-Function hatte aber **keinen Action-Pfad für `drain:true`**: Default-Branch `submit_new` läuft eigene Discovery-Loop und ignoriert pending Rows. → 92 course_package-Submissions blieben 14 Tage stuck.

## Fix
- **Neue Actions** in `seo-submit-indexnow`:
  - `drain_pending`: claimt Pending-Rows (priority+created_at ASC), chunked (default 50, max 200), POST an api.indexnow.org, status=success/failed, http_status, error_message, started_at/finished_at, retry_count++ pro fehlgeschlagenem Row, `auto_heal_log action_type=indexnow_drain_pending` Audit.
  - `backfill_sitemap`: lädt sitemap-index → sub-sitemaps → alle `<loc>` URLs, dedupiert gegen pending+success-30d, inserted in Chunks à 500. Audit `indexnow_backfill_sitemap`.
- **Cron-Trigger Body** umgeschaltet: `{action:"drain_pending",limit:200,chunk_size:50}` (Legacy `drain:true` weiter unterstützt).
- **Retry-Refinement** in derselben Edge-Function: exponential backoff 5min × 2^retry_count (max 24h), max 5 Retries, 20 URLs/Run.

## Backfill-Erfolg 2026-05-25 05:10 UTC
- 92 Course-Package-Pendings gedrained: 92/92 success.
- Sitemap-Backfill: 2234 URLs aus 6 Sub-Sitemaps enqueued + in 5 Wellen gedrained (alle HTTP 200).
- Endstand: 2634 success-Rows (308 auto_discovery + 92 course_package + 2234 sitemap_backfill), 0 pending, 0 failed.

## Dashboard `/admin/seo/indexnow`
- KPIs: Pending, Success 24h/7d, Failed gesamt, Coverage % (success / sitemap-hint 2601).
- Coverage-Bar + letzte Submission.
- Tabelle Coverage pro URL-Pfad (Proxy für Sub-Sitemap-Aufschlüsselung).
- Aufschlüsselung pro source_type×status, älteste 20 Pendings, letzte 20 Failures.
- Buttons: Drain (max 500), Backfill Dry-Run, Backfill Live, Failed Retry.

## RPC
`admin_get_indexnow_status_summary()` SECURITY DEFINER + has_role(admin), liefert totals/by_source/by_path_prefix/recent_failures/oldest_pending. EXECUTE nur authenticated.

## Indizes
- `idx_seo_submission_logs_pending` (provider, status, created_at) WHERE status='pending'
- `idx_seo_submission_logs_url` (url, created_at DESC)

## Lehre
Cron-Body und Edge-Function-Action müssen synchron sein. `drain:true` als Marker ohne expliziten Action-Branch = silent submit_new. Pflicht-Smoke-Test bei Cron-Body-Änderung.
