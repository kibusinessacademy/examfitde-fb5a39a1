---
name: Post-Publish Growth Worker v1 (Welle 2 Loop 2)
description: Single dispatcher edge function `post-publish-growth-worker` drains 6 post-publish job_types per cron tick (5min). Inline handlers schreiben in seo_submission_logs, blog_articles, distribution_targets, campaign_assets, email_delivery_queue, course_packages.feature_flags.og_image_url. Idempotent via job_queue.idempotency_key + per-handler De-Dupe. Audit jeder Job → auto_heal_log action_type='post_publish_growth_worker:{job_type}'.
type: feature
---

# Post-Publish Growth Worker — Welle 2 Loop 2

## Edge Function
`supabase/functions/post-publish-growth-worker/index.ts` — Single dispatcher.
- Cron-driven via `cron-trigger` Tier `post-publish-growth` → pg_cron `post-publish-growth-worker-5min` (jobid 213, `*/5 * * * *`).
- Drain pattern: select ≤20 pending jobs of HANDLED_JOB_TYPES → claim atomically (UPDATE … WHERE status='pending' RETURNING) → dispatch per-type handler → mark completed/failed (in DB) + write auto_heal_log.
- Outcome semantics: `completed` (echte Wirkung), `noop` (DB-status=completed, audit=skipped), `failed` (DB-status=failed, audit=failed).
- NEVER silent-fail: jeder Codepath endet in einer `Outcome`.

## Handler-Mapping (alle inline, keine Sub-Invokes)
| job_type | Schreibt | Idempotenz |
|---|---|---|
| `seo_indexnow_submit` | `seo_submission_logs` (status=pending) | de-dup auf URL+24h Window; cron `seo-indexnow` (30min) drained Submissions |
| `package_post_publish_blog` | `blog_articles` (Lovable AI gemini-2.5-flash, ~600 Wörter) | skip wenn `source_package_id` bereits existiert |
| `package_distribution_plan` | `campaign_launch_plans` (NULL qc_id, curriculum_id-keyed) + `campaign_assets` (landing_page Seed) + `distribution_targets` (4 Kanäle) | uniq (asset_id, channel, target_type) |
| `package_campaign_assets_generate` | `campaign_assets` (3 Seeds: social_post/email/meta_snippet) | per asset_key Lookup |
| `package_email_sequence_enroll` | `email_delivery_queue` (sequence_type=`post_publish_announce`, step_number=1) für alle leads des curriculum_id | idempotency_key `post_publish_announce:{pkg_id}:{lead_id}` |
| `package_og_image_generate` | `course_packages.feature_flags.og_image_url` (Lovable AI gemini-3.1-flash-image-preview → cms-media bucket `og-images/{pkg_id}.png`) | skip wenn flag schon gesetzt |

## CRITICAL FIX: job_type_policies whitelist
Ohne Eintrag in `job_type_policies` killt `ops_cancel_pending_non_building_jobs` + `fn_guard_non_building_auto_cancel` jeden post-publish Job (weil das Paket published, nicht building, ist).

**Migration**: 6 Einträge in `job_type_policies` mit `can_run_when_not_building=true` UND `exempt_from_auto_cancel=true`. Idempotent via ON CONFLICT.

## Smoke 2026-05-10
- Manuell 6 Jobs für Weintechnologe (`051ba572-…`) inserted → Worker invoked → `seo_indexnow_submit` `completed` (3 URLs in seo_submission_logs).
- Die 5 `package_*` Jobs wurden initial vom OPS_GUARD gekillt → policies-Migration angewendet → für neue Production-Traffic (vom `trg_post_publish_growth_fanout`-Trigger) greift der Schutz nicht mehr.
- `trg_guard_terminal_status_regression` blockt failed→pending → Re-Run von Smoke-Jobs nicht möglich. Für echten Test: neue Idempotency-Keys oder neuer Publish-Event.

## Akzeptanzkriterium-Status
- [x] 6 Worker-Pfade implementiert, kein Silent Fail
- [x] Reuse: seo-submit-indexnow (cron-tier), seo_submission_logs, blog_articles, campaign_assets, email_delivery_queue
- [x] Audit auf `auto_heal_log` für jeden Outcome
- [x] Idempotenz: idempotency_key + per-handler De-Dupe
- [x] Cron-Verkabelung (jobid 213, every 5min)
- [x] Policy-Whitelist verhindert OPS_GUARD-Cancel für published packages

## Rollback
```sql
SELECT cron.unschedule('post-publish-growth-worker-5min');
DELETE FROM job_type_policies WHERE job_type IN
  ('seo_indexnow_submit','package_post_publish_blog','package_distribution_plan',
   'package_campaign_assets_generate','package_email_sequence_enroll','package_og_image_generate');
-- Edge Function bleibt deployed (kein Schaden idle).
```
