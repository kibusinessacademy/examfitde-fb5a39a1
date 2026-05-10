---
name: Growth Orchestration Quality Gate v1.1
description: 8-Dim Quality-Score + Welle 4.1 Per-Subscore-Repair-Dispatch + Drilldown-Modal
type: feature
---

## SSOT
- View `public.v_growth_quality_scores` (service_role only) berechnet 8 Subscores 0..100 pro published package
- `growth_quality_score` = avg der 8 Subscores · Buckets green ≥80, yellow 50–79, red <50

## RPCs (admin-gated via has_role)
- `admin_get_growth_quality_summary()` → counts + avg + avg_subscores
- `admin_get_growth_quality_details(p_limit, p_min, p_max)` → worst-first Liste
- `admin_get_growth_quality_package_detail(uuid)` (v1.1) → scores + signals (blog/og/IL/distribution/email/funnel) + recent_jobs + recent_heal_log
- `admin_dispatch_growth_quality_repair(uuid, subscore)` (v1.1) → enqueue Repair-Job mit Idempotenz `growth_quality_repair:<sub>:<pkg>:<YYYYMMDDHH>`
- `fn_compute_growth_quality_score(uuid)` (service_role) → jsonb für single package

## Subscore → Job-Type Mapping (v1.1)
| Subscore | Job-Type |
|---|---|
| blog_quality | package_post_publish_blog |
| seo_meta | package_auto_generate_seo_suite |
| internal_links | seo_internal_links |
| cta | growth_quality_repair_cta (neu, marketing lane) |
| funnel_events | growth_quality_repair_funnel_audit (neu, marketing lane) |
| email_sequence | package_email_sequence_enroll |
| distribution | package_distribution_plan |
| og_image | package_og_image_generate |

## Audit
- `auto_heal_log.action_type='growth_quality_repair_dispatch'` mit metadata: subscore, job_type, job_id, idempotency_key, actor_uid
- result_status: enqueued | skipped (idempotency_active)

## Retention
- `admin_settings.post_publish_growth_health_retention_days` (default 90, min 7)
- `fn_cleanup_post_publish_growth_health_snapshots(p_retain_days)` setting-driven
- `admin_set_post_publish_growth_retention_days(int)` validates 7..3650
- `admin_get_post_publish_growth_cleanup_status()` für Cockpit-UI
- Cron 219 (`23 3 * * *`) ruft mit NULL → setting

## UI
- `GrowthQualityScoreCard` (Tab `fanout` der GrowthPage):
  - Summary, Avg-Subscores, Worst-25 mit ≤40/60/80/100 Filter
  - Klick auf Paketzeile öffnet `PackageDetailDialog` (Modal)
- `PackageDetailDialog`:
  - Subscores mit Per-Subscore „Fix"-Button → ruft `admin_dispatch_growth_quality_repair`
  - Signals-Spalte (Blog-Count, IL-Count, Funnel-30d, Email-Enrollments, OG-URL)
  - Letzte 10 Repair-/Growth-Jobs aus job_queue
  - Letzte 15 Repair-Audits aus auto_heal_log
- `PostPublishGrowthHealthCard` Retention-Sektion bleibt wie v1

## Baseline 2026-05-10
- 142 published gescored, avg 29.99 (0g/18y/124r)
- Repair-Dispatch RPC manuell, kein Cron — Bulk/Cron erst nach Beobachtung der Worker-Verarbeitung für die zwei neuen Job-Types

## Open Items (v1.2 candidates)
- Edge-Worker für `growth_quality_repair_cta` und `growth_quality_repair_funnel_audit` (aktuell pending in queue, kein Konsument)
- Bulk-Dispatch „Top-25 Worst pro Subscore"
- Cron mit WIP-Cap
