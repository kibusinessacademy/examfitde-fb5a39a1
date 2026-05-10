---
name: Post-Publish Growth Self-Heal v1.2 (Welle 3 + 3.1 + 3.2 Trends)
description: fn_run_post_publish_growth_health_check(p_repair,p_limit=25,p_job_type) — chunked CTE statt TEMP TABLE, Anti-Join Cooldown + LIMIT vor Loop. Detect 90ms / Repair 1.5–2.6s (gemessen 142 published × 7 Artefakt-Typen, 674 Drift). Partial-Index idx_auto_heal_log_growth_repair WHERE action_type LIKE 'post_publish_growth_repair:%'. 30min Cooldown via auto_heal_log, 25 repairs/run cap, idempotency_key growth_repair:{jt}:{pkg}:{YYYYMMDDHH}. admin_get_post_publish_growth_health + admin_run_post_publish_growth_repair(p_repair,p_limit,p_job_type) admin-gated. Cron post-publish-growth-health-15min (jobid 214). CI guard scripts/guards/post-publish-growth-policies-guard.mjs (npm run guard:growth-policies + workflow post-publish-growth-policies-guard.yml). UI PostPublishGrowthHealthCard im Fanout-Tab.
type: feature
---

## Detector
Iteriert v_post_publish_growth_coverage × 7 artifact job_types. Bei p_repair=true: skip wenn Cooldown (auto_heal_log action_type='post_publish_growth_repair:{jt}' für target_id+30min) oder wenn Whitelist-Check fail. Insert in job_queue mit idempotency_key, audit zu auto_heal_log. Stuck/OPS_GUARD-Counters separat.

## RPCs
- fn_run_post_publish_growth_health_check(boolean) — service_role only
- admin_get_post_publish_growth_health() — has_role('admin')
- admin_run_post_publish_growth_repair(boolean default true) — has_role('admin')

## Smoke 2026-05-10
- Detect-Run: 674 drift erkannt (38/142 mit Blog, fehlende sitemap/internal_links/og), 509 stuck pending (Backfill), 10 ops_guard 24h.
- Repair-Run timeout via API, läuft aber via Cron (15min) zuverlässig idempotent.

## Akzeptanz
- [x] Detector schreibt auto_heal_log für jedes Outcome
- [x] Cooldown 30min/package/job_type
- [x] Whitelist-Respekt via fn_is_job_type_whitelisted_for_non_building_package
- [x] Cron 15min, 25/run cap
- [x] Admin RPC + Card
- [x] CI-Guard
