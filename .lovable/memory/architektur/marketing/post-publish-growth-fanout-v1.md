---
name: Post-Publish Growth Fanout v1
description: Trigger trg_post_publish_growth_fanout enqueued 9 Growth-Jobs idempotent bei echtem Übergang nach published. v_funnel_event_loss + cron funnel-loss-detect-hourly machen Tracking-Drift sichtbar (paid orders vs checkout_complete vs pricing_view). Cron-Trigger-Tiers seo-indexnow (30min) + seo-retry (15min) drainen seo_submission_logs via cron-trigger.
type: feature
---

# Post-Publish Growth Orchestration — Welle 1 (P0)

## Trigger
`trg_post_publish_growth_fanout` AFTER UPDATE OF (status, is_published) ON course_packages
- WHEN: NEW.status='published' AND is_published=true AND echte Transition (OLD distinct NEW)
- Skipt no-op und re-publish (OLD bereits published)
- Ruft `fn_post_publish_growth_fanout()` SECURITY DEFINER

## Enqueued Jobs (9, idempotent via job_queue.idempotency_key)
1. `package_auto_generate_seo_suite` (existing)
2. `seo_sitemap_refresh` (existing, reused — NICHT seo_sitemap_regen)
3. `seo_indexnow_submit` (NEW)
4. `package_post_publish_blog` (NEW)
5. `seo_internal_links` (existing, reused — NICHT seo_internal_links_rebuild)
6. `package_og_image_generate` (NEW)
7. `package_distribution_plan` (NEW)
8. `package_campaign_assets_generate` (NEW)
9. `package_email_sequence_enroll` (NEW)

Idempotency-Key: `post_publish_growth:{package_id}:{job_type}` → unique partial index `job_queue_idempotency_active` verhindert Duplikate auf pending/processing.

## Conversion-Event
`event_type='package_published'` (neu in Whitelist) wird vom Trigger inserted mit metadata.package_id (top-level package_id ist generated column).

## Audit
Jeder Lauf → `auto_heal_log` action_type='post_publish_growth_fanout' mit jobs_enqueued/skipped + Job-Liste.
Per-Error → action_type='post_publish_growth_enqueue_error'.

## Manual Backfill
`admin_backfill_post_publish_growth(p_package_id uuid)` — admin-gated via has_role, gleicher Pfad.
KEIN automatischer Backfill der 49 published Pakete (zu viel Queue-Druck) — gezielt manuell.

## Funnel-Loss-Detector
- View `v_funnel_event_loss` — 24h-Fenster: paid_orders, checkout_complete, checkout_started, pricing_view, parity_pct, status, pricing_view_drought.
- Status: <50%=CRIT, <95%=WARN, sonst OK; 0 paid=noop.
- View HARD locked (REVOKE FROM PUBLIC,anon,authenticated, GRANT service_role) — Zugriff nur via `admin_get_funnel_event_loss()` mit has_role-Gate.
- `fn_detect_funnel_event_loss()` SECURITY DEFINER schreibt jeden Lauf in auto_heal_log (action_type='funnel_event_loss_detection') auch bei OK/noop (keine Datenholes).
- Cron `funnel-loss-detect-hourly` (jobid=210, schedule='11 * * * *') ruft die Heal-Fn.
- **Baseline 2026-05-10**: 4 paid / 0 checkout_complete / 0 pricing_view → CRIT bestätigt P0-Drift aus Audit.

## SEO Sitemap + IndexNow
- cron-trigger erweitert um Tiers `seo-indexnow` → `seo-submit-indexnow`, `seo-retry` → `seo-retry-failed-submissions`.
- Cron `seo-indexnow-submit-30min` (jobid=211, '*/30 * * * *') drained Submission-Queue.
- Cron `seo-retry-failed-submissions-15min` (jobid=212, '*/15 * * * *') retried Failed-Submissions in `seo_submission_logs`.

## NICHT in Welle 1
- Backfill der 49 published Pakete (manuell via admin_backfill_post_publish_growth)
- Worker-Implementierungen für 6 neue job_types (Welle 2)
- Email-Enrollment-Logik (Welle 2)
- Cockpit-Cards (Welle 3)
- Self-Heal-Detectors (Welle 2/3)

## Schema-Recon-Lessons
- `seo_internal_links_rebuild`/`seo_sitemap_regen` aus Audit existierten NICHT — `seo_internal_links`/`seo_sitemap_refresh` sind die SSOT-Namen.
- `course_packages` hat KEIN `persona`-Feld → aus Event-Metadata weglassen.
- Doppel-Trigger `trg_seo_pages_auto_publish_on_package` aus Audit existiert NICHT — nur `trg_auto_publish_seo_pages` (anderer Concern: SEO-Page-Status-Flip, bleibt).

## Rollback-Hint
```sql
DROP TRIGGER trg_post_publish_growth_fanout ON course_packages;
DROP FUNCTION fn_post_publish_growth_fanout() CASCADE;
DROP FUNCTION admin_backfill_post_publish_growth(uuid);
DROP VIEW v_funnel_event_loss;
DROP FUNCTION admin_get_funnel_event_loss();
DROP FUNCTION fn_detect_funnel_event_loss();
SELECT cron.unschedule('funnel-loss-detect-hourly');
SELECT cron.unschedule('seo-indexnow-submit-30min');
SELECT cron.unschedule('seo-retry-failed-submissions-15min');
DELETE FROM ops_job_type_registry WHERE job_type IN
  ('seo_indexnow_submit','package_post_publish_blog','package_og_image_generate',
   'package_distribution_plan','package_campaign_assets_generate','package_email_sequence_enroll');
```
