---
name: Track M3 Owner Reporting Digest + Co-Purchase Upsell Discovery
description: Wöchentlicher/monatlicher Owner-Digest pro Org via notification_jobs (kind=org_owner_digest) + Auto-Discovery von Upsell-Paths aus learner_course_grants Co-Purchase-Mustern mit Admin Review→Promote zu curriculum_upsell_paths.
type: feature
---

# Track M3 — Owner Reporting + Upsell Discovery (2026-05-16)

## Scope
Schließt zwei M2-Auslassungen:
- Owner-Reporting-Webhook (E-Mail-Digest pro Org)
- Upsell-Path-Discovery aus Co-Purchase

## Neue Tabellen
- `curriculum_upsell_path_suggestions` (source/target, support_count, source_buyer_count, confidence, lift, status, promoted_path_id) — UNIQUE (source,target), CHECK source≠target, admin-only RLS.
- `org_owner_digests` (org_id, period weekly|monthly, period_start/_end, payload, recipients_count, enqueued_job_ids) — UNIQUE (org_id, period, period_start), admin-only RLS.

## Neue Intents
- `org_owner_weekly_digest` (sensitive, max_per_day=1)
- `org_owner_monthly_digest` (sensitive, max_per_day=1)

## notification_jobs.kind erweitert
+ `org_owner_digest`

## Producer (service_role)
- `fn_discover_upsell_paths_from_copurchases(dry_run)` — Pairs aus `learner_course_grants` mit `support≥2` und `confidence≥0.05`. UPSERT auf (source,target). Audit `auto_heal_log.action_type='upsell_path_discovery_run'`.
- `fn_emit_org_owner_digests(period, dry_run)` — pro aktiver Org mit ≥1 aktiver Lizenz. Payload: active_licenses, total/used seats, expiring_30d, active_learners. Job pro owner+admin der Org via dedupe_key `<intent>:<org>:<period_start>:<user>`. Period-Lock via `org_owner_digests` UNIQUE.

## Admin RPCs
- `admin_get_upsell_suggestions(status, limit)` mit Curriculum-Title-Join
- `admin_review_upsell_suggestion(id, approve|reject)` — approve promotet zu `curriculum_upsell_paths` mit weight=max(confidence,0.1)
- `admin_get_org_digest_history(period, limit)`
- `admin_smoke_track_m3()` — Intents/Constraint + beide Producer-Dry-Runs

## Cron
- `upsell-discovery-weekly` (`15 4 * * 1`)
- `org-owner-digest-weekly` (`0 8 * * 1`)
- `org-owner-digest-monthly` (`0 9 1 * *`)

## UI
- `UpsellDiscoveryCard` (HealCockpitPage Notification-Sektion) — Tabs Suggestions/Digests + Approve/Reject + Smoke

## Bewusste Auslassungen (Track M4)
- Stripe-Renewal-Reverse: aktuell nur via M2 cancel_at_period_end-Check
- Auto-Promote Suggestions ab Confidence≥X (heute manual review)
- Owner-Digest Render+Send-Edge (heute: Job landet via Notification-Pipeline; Email-Template noch generisch)
