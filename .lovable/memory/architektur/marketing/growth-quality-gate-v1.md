---
name: Growth Orchestration Quality Gate v1.2
description: Welle 4.2 — Per-Subscore Repair-Worker (CTA + Funnel-Audit), Bulk-Dispatch, Detail-Signal-Fix
type: feature
---

## SSOT
- View `public.v_growth_quality_scores` (service_role only) berechnet 8 Subscores 0..100 pro published package
- `growth_quality_score` = avg der 8 Subscores · Buckets green ≥80, yellow 50–79, red <50

## RPCs (admin-gated via has_role)
- `admin_get_growth_quality_summary()` → counts + avg + avg_subscores
- `admin_get_growth_quality_details(p_limit, p_min, p_max)` → worst-first Liste
- `admin_get_growth_quality_package_detail(uuid)` → scores + signals + recent_jobs (incl. result jsonb) + recent_heal_log (v1.2: korrekte Spalten blog_articles.source_package_id, distribution_targets.curriculum_id, kein Phantom seo_internal_links-Tabellenzugriff mehr)
- `admin_dispatch_growth_quality_repair(uuid, subscore)` → enqueue Repair-Job mit Idempotenz `growth_quality_repair:<sub>:<pkg>:<YYYYMMDDHH>`
- `admin_bulk_dispatch_growth_quality_repair(p_subscore, p_limit=10)` (v1.2) → Top-N Worst (<50) pro Subscore, idempotent, Audit `growth_quality_bulk_dispatch`
- `fn_compute_growth_quality_score(uuid)` (service_role) → jsonb für single package

## Audit-RPCs für Repair-Worker (service_role only, v1.2)
- `fn_audit_growth_cta(p_package_id)` → verdict + recommended_action aus cta_visible/click events + campaign_assets cta-Detection
- `fn_audit_growth_funnel(p_package_id)` → 6 Pflicht-Events (landing_view, quiz_started, lead_capture_submitted, checkout_started, checkout_complete, cta_visible) Coverage-Map + missing-Liste

## Subscore → Job-Type Mapping
| Subscore | Job-Type | Worker |
|---|---|---|
| blog_quality | package_post_publish_blog | bestehend |
| seo_meta | package_auto_generate_seo_suite | bestehend |
| internal_links | seo_internal_links | bestehend |
| cta | growth_quality_repair_cta | **growth-quality-repair-worker** (neu) |
| funnel_events | growth_quality_repair_funnel_audit | **growth-quality-repair-worker** (neu) |
| email_sequence | package_email_sequence_enroll | bestehend |
| distribution | package_distribution_plan | bestehend |
| og_image | package_og_image_generate | bestehend |

## Edge-Function: growth-quality-repair-worker (v1.2)
- Claimt bis 10 pending Jobs der zwei neuen Types (oldest first), soft-claim via UPDATE…WHERE status='pending'
- Ruft `fn_audit_growth_cta` / `fn_audit_growth_funnel` per service_role
- Schreibt Resultat in `job_queue.result` + markiert completed/failed
- Audit-Log `action_type='growth_quality_repair_worker'` mit verdict + recommended_action
- Cron 220 `growth-quality-repair-worker-5min` (`*/5 * * * *`)

## Audit-Trail
- `growth_quality_repair_dispatch` — Single-Dispatch UI/RPC (enqueued|skipped)
- `growth_quality_bulk_dispatch` — Bulk-Dispatch (enqueued|skipped, summary in metadata)
- `growth_quality_repair_worker` — Worker-Run pro Job (completed|failed, verdict in metadata)

## Retention
- `admin_settings.post_publish_growth_health_retention_days` (default 90, min 7), Cron 219

## UI
- `GrowthQualityScoreCard` (Tab `fanout` der GrowthPage):
  - Summary mit Avg + green/yellow/red Counts
  - Avg-Subscores mit **Bulk-Repair-Button pro Zeile** (Top-10 Worst pro Subscore)
  - Worst-25 Filter ≤40/60/80/100
  - Klick auf Paketzeile → `PackageDetailDialog`
- `PackageDetailDialog`:
  - Subscores mit Per-Subscore „Fix"-Button → single-dispatch RPC
  - Signals (Blog-Count, IL-Count, Funnel-30d, Email-Enrollments, OG-Image-Count, IndexNow/Sitemap-Status)
  - Letzte 10 Jobs (mit `result` jsonb für Verdict-Audit)
  - Letzte 15 Repair-Audits

## Smoke 2026-05-10
- E2E: enqueue funnel_audit job → cron-worker claimed → audit RPC → completed verdict=red ✓
- Bulk-Dispatch RPC kompiliert + admin-gated ✓
- Detail-RPC liefert vollständige Signale (kein Exception-Fallback mehr) ✓

## Open Items (v1.3 candidates)
- Cron-getriebene Bulk-Repair je Subscore mit WIP-Cap (Phase nach Beobachtung des Worker-Throughput)
- Verdict-Trend-Chart für CTA/Funnel pro Paket
