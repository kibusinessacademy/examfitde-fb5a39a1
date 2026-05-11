---
name: Sitemap Refresh Decommission + Linker Result-Shape Phase 2
description: seo_sitemap_refresh strukturell entfernt aus v_post_publish_growth_coverage (column has_sitemap_refresh raus + sm CTE raus), job_type_policies, ops_job_type_registry, src/lib/jobs/{job-registry,enqueue}.ts, supabase/functions/_shared/{runner-lanes,job-map}.ts. Sitemap ist global on-demand via /functions/v1/generate-sitemap — kein per-Paket-Worker existiert. seo-internal-linker liefert jetzt {ok:true, generated:totalLinks, batch_complete:true, remaining:0, documents_processed, documents_updated, report} statt legacy {success:true,...} → content-runner classifier akzeptiert als real result, kein EMPTY_RESULT-Loop mehr.
type: feature
---

## Why
Phase-2 Diagnose: 2 Root-Causes des EMPTY_RESULT-Loops.
1. seo_sitemap_refresh routete auf generate-sitemap (HTTP XML endpoint, kein Worker) → strukturell unmöglich completable.
2. seo-internal-linker returnte {success:true, ...} ohne ok/generated/batch_complete → classifier (content-runner Z.647-651) klassifiziert als EMPTY_RESULT → 26-Attempt-Loop.

## Migration 20260511155904
- DROP+RECREATE v_post_publish_growth_coverage ohne sm CTE und has_sitemap_refresh column (REVOKE PUBLIC, GRANT service_role).
- DELETE FROM job_type_policies, ops_job_type_registry WHERE job_type='seo_sitemap_refresh'.
- DO-Block Smoke wirft EXCEPTION wenn rows zurückbleiben.
- Audit action_type='sitemap_refresh_decommissioned' mit removed_from-Liste + rollback_hint.

## Result-Shape Contract (für künftige Worker)
Worker MUSS minimal liefern:
- `ok: true` (boolean) ODER
- `generated: <n>` mit n>0 ODER
- `batch_complete: true`
Sonst → EMPTY_RESULT (DLQ via fn_drain_stuck_empty_result_growth_jobs aus Phase 1).

## Code-Cleanup
- src/lib/jobs/job-registry.ts: 'seo_sitemap_refresh' aus KNOWN_JOB_TYPES.
- src/lib/jobs/enqueue.ts: aus 'seo-content' preset entfernt.
- supabase/functions/_shared/runner-lanes.ts: aus 2 Sets entfernt (generation+marketing).
- supabase/functions/_shared/job-map.ts: route gelöscht.

## Nicht entfernt (bewusst)
- SeoJobHealthCard rollback-flag UI für `seo_sitemap_refresh_producer_enabled` bleibt (harmlos, ops_feature_flags row existiert noch — kein Producer mehr aktiv).
- src/integrations/supabase/types.ts.has_sitemap_refresh wird beim nächsten types-regen automatisch verschwinden.

## Smoke 2026-05-11
- 0 rows in job_type_policies, ops_job_type_registry, view-column has_sitemap_refresh
- 1 audit row in last 15min
- 0 pending/processing seo_sitemap_refresh jobs
- Contract-Test src/__tests__/seo-internal-linker.contract.test.ts: 5/5 grün

## Defer (nicht in dieser Welle)
- F2 (seo_internal_link_suggestions als SSOT-Ziel + Idempotenz): Tabelle hat 3855 rows OHNE Unique-Constraint. Schema-Härtung + Migration der Linker-Writes als eigene Subphase.
- F5 (seo_job_health_alert Mindest-Sample/6h-Fenster): separater Tooling-Patch.

## Rollback
```sql
-- 1) Reinsert registry/policies
INSERT INTO ops_job_type_registry (job_type, ...) VALUES ('seo_sitemap_refresh', ...);
INSERT INTO job_type_policies (job_type, can_run_when_not_building, exempt_from_auto_cancel, worker_pool, notes)
VALUES ('seo_sitemap_refresh', true, true, 'default', 'restored');
-- 2) View-Restore: vorherige Version aus migration 20260511072747 oder älter.
-- 3) Code: git revert der ts-changes + linker response shape.
```
NUR rollback wenn ein echter per-Paket sitemap-Handler implementiert wird.
