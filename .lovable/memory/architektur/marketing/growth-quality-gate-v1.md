---
name: Growth Orchestration Quality Gate v1
description: 8-Dimensionen Quality-Score pro published package + Retention-Config UI für Health-Snapshots
type: feature
---

## SSOT
- View `public.v_growth_quality_scores` (service_role only) berechnet 8 Subscores 0..100 pro published package:
  blog_quality, seo_meta, internal_links, cta, funnel_events (30d), email_sequence, distribution, og_image
- `growth_quality_score` = avg der 8 Subscores
- Buckets: green ≥80, yellow 50–79, red <50

## RPCs (admin-gated via has_role)
- `admin_get_growth_quality_summary()` → counts + avg + avg_subscores
- `admin_get_growth_quality_details(p_limit, p_min, p_max)` → worst-first Liste mit allen Subscores
- `fn_compute_growth_quality_score(uuid)` (service_role) → jsonb für single package

## Retention
- Setting-Key: `admin_settings.post_publish_growth_health_retention_days` (default 90, min 7)
- `fn_cleanup_post_publish_growth_health_snapshots(p_retain_days)` liest Setting wenn param NULL
- `admin_set_post_publish_growth_retention_days(int)` validates 7..3650
- `admin_get_post_publish_growth_cleanup_status()` → retain_days + last_cleanup auto_heal_log + snapshot_count/oldest/newest
- Cron job 219 (`post-publish-growth-health-snapshot-cleanup-daily`, `23 3 * * *`) ruft jetzt mit NULL → setting-driven

## UI
- `src/components/admin/growth/GrowthQualityScoreCard.tsx` (Avg Score, Subscores, Top-25 Worst Packages mit Score-Filter ≤40/60/80/100)
- `PostPublishGrowthHealthCard` erweitert um Retention-Sektion (Tage-Input, Save, Cleanup-jetzt, last_cleanup-Status)
- Eingebunden im Tab `fanout` der GrowthPage

## Baseline 2026-05-10
- 142 published packages gescored
- 0 green / 18 yellow / 124 red, avg 29.9 — erwartet, weil Funnel-Events & CTA-Detection Strict
