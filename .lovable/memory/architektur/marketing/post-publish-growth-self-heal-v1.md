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

## v1.2 (Welle 3.2 — Trends, 2026-05-10)
- Neu: Tabelle `post_publish_growth_health_snapshots` (run_at, status, 7 Coverage-%, stuck pending/processing, ops_guard 24h, top_issues jsonb). RLS lockdown — nur service_role schreibt/liest direkt.
- SSOT-Refactor: `fn_compute_post_publish_growth_health()` (kein has_role-Gate, service_role) liefert die Live-Health. `admin_get_post_publish_growth_health` delegiert nach has_role-Check. Verhindert "permission denied" beim Cron-Capture (auth.uid() ist NULL).
- `fn_capture_post_publish_growth_health_snapshot()` schreibt einen Snapshot + Audit in auto_heal_log (action_type='post_publish_growth_health_snapshot', metadata={snapshot_id,status}).
- Cron `post-publish-growth-health-snapshot-hourly` (`7 * * * *`) — stündlicher Snapshot.
- Admin RPC `admin_get_post_publish_growth_health_trends(p_days int default 7)` — Trend-Reihe für 7d/30d, has_role admin.
- UI: `PostPublishGrowthHealthCard` zeigt 7d/30d-Toggle, Coverage-Lines (7 Artefakte, recharts) + Mini-Sparklines für Stuck-Jobs und OPS_GUARD. Keine Fake-Historie — leerer Zeitraum wird sauber kommuniziert.

## v1.3 (Welle 3.2 Abschluss — Drilldown + Retention, 2026-05-10)
- Smoke grün: Cron 217 active (`7 * * * *`), Initial-Snapshot vorhanden, Audit success, RPC liefert Trends.
- Retention: `fn_cleanup_post_publish_growth_health_snapshots(p_retain_days default 90)` löscht Snapshots > 90d, schreibt Audit `post_publish_growth_health_snapshot_cleanup` (success/noop). Daily-Cron `post-publish-growth-health-snapshot-cleanup-daily` (`23 3 * * *`). Smoke-Run: 0 deleted (clean baseline).
- Drilldown: `admin_get_post_publish_growth_health_snapshot_detail(uuid)` (admin-only) liefert kompletten Snapshot inkl. top_issues. Trends-RPC neu mit `id`-Spalte (DROP+CREATE wegen Signaturänderung).
- UI: HealthCard hat Klick auf Coverage-/Stuck-/OPS_GUARD-Charts → Dialog mit Coverage-Bars + Top-Drift; zusätzlich Quick-Pick-Liste der letzten 8 Snapshots als Buttons.
