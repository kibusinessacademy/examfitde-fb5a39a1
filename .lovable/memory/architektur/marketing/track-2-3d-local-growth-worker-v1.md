---
name: Track 2.3d Local Growth Repair Worker v1
description: Cron-driven 30min Worker für FANOUT_NOT_STARTED. v_growth_repair_local_targets_v1 (class+scope) projiziert Eligibility. _growth_local_worker_run shared, admin RPCs + _growth_local_worker_cron_tick. Hard-cap 25/run. Reused _growth_repair_decide (cooldown + idem-key + active-job-block + mapping). TRACKING_NOT_EMITTED nur reported, nie dispatched.
type: feature
---

# Track 2.3d — Local Growth Repair Worker (2026-05-16)

## Konsum-Quelle
`v_growth_repair_local_targets_v1` (service_role only) — projiziert `v_growth_repair_eligibility_v1` mit `fn_growth_repair_class(signal) → (class, scope)`. Worker filtert intern:
- `class = 'FANOUT_NOT_STARTED'` (blog, og_image, indexnow, internal_links, campaign_assets, distribution_targets)
- `scope = 'local'`
- `safe_to_repair = true`
- `expected_job_type IS NOT NULL`

`TRACKING_NOT_EMITTED` (tracking_pricing_view, tracking_checkout_started) ist `requires_platform_fix=true` in der Eligibility-View → 0 Dispatches by construction, aber im Summary als "platform-fix" angezeigt.

## RPCs (SECURITY DEFINER, search_path=public)
- `admin_growth_local_worker_dry_run(_limit=25)` — admin-gated, hard-cap 25
- `admin_growth_local_worker_live(_limit=25, _reason)` — admin-gated, Reason ≥3 Zeichen Pflicht
- `admin_growth_local_worker_summary()` — KPIs (fanout_safe / fanout_blocked / tracking_total / by_signal) + letzte 10 Runs
- `_growth_local_worker_cron_tick()` — service_role/postgres only (`session_user IN ('postgres','supabase_admin','service_role')`), kein auth.uid Check; ruft `_growth_local_worker_run('live', 25, 'cron: 30min tick', NULL, '_growth_local_worker_cron_tick')`
- `_growth_local_worker_run(_mode, _limit, _reason, _actor, _trigger_source)` — internal shared (dry_run|live)

## Cron
- `growth-local-worker-30min` — `*/30 * * * *` → `SELECT public._growth_local_worker_cron_tick();`

## Wiederverwendung 2.3c
- `_growth_repair_decide` liefert canonical_job_type / worker_pool / priority / idempotency_key
- `growth_repair_job_type_map` Mapping bleibt SSOT (kein Inferenz)
- `growth_repair_dispatch_cooldown` Tabelle wird upserted
- Idempotency-Key Format unverändert: `growth_repair:{pkg}:{signal}:{expected_job_type}:{YYYYMMDDHH}`
- `_origin = 'growth_local_worker_v1'` im payload (unterscheidet sich von `growth_repair_dispatcher_v1` aus 2.3c)
- `dispatcher = 'growth_local_worker_v1'` in `job_queue.meta`

## Hard Guards (defense in depth)
1. `class = FANOUT_NOT_STARTED` only (TRACKING_NOT_EMITTED bypass-immun durch requires_platform_fix)
2. View-Filter: safe_to_repair, expected_job_type, scope=local
3. `_growth_repair_decide` checkt: REQUIRES_PLATFORM_FIX, blocked_reason, NOT_SAFE_TO_REPAIR, ACTIVE_JOB_PRESENT (×2), NO_EXPECTED_JOB_TYPE, UNMAPPED_JOB_TYPE, UNREGISTERED_JOB_TYPE, COOLDOWN_ACTIVE
4. INSERT job_queue mit unique_violation auf idempotency_key → IDEMPOTENCY_CLASH skip
5. Hard-Cap 25 pro Run (auch wenn caller höher anfordert)

## Audit (auto_heal_log)
- Pro Attempt (live only): `action_type='growth_local_worker_attempt'`, result_status ∈ (dispatched, skipped, failed), target_id=package_id
- Pro Run (beide Modi): `action_type='growth_local_worker_run'`, target_id=run_id, target_type='system', metadata={run_id, mode, scanned, dispatched, skipped, failed, actor}
- Init: `action_type='track_2_3d_init'` (Baseline 2026-05-16)

## UI
`GrowthClassificationCard` → neue Sektion **Local Repair Worker · Track 2.3d** (unter Eligible Repairs):
- KPI-Pills: Fanout · safe / Fanout · blocked / Tracking · platform-fix / By signal
- Per-Signal Badges (blog/og_image/indexnow/internal_links: counts)
- Dry-Run + Run-Now (Reason-Prompt)
- Recent runs (10) mit mode (dry_run|live) + dispatched/skipped/failed Counts

## Invarianten
- KEINE Mutation von customer_safe, course_packages.status, Entitlements, Sellability
- Kein inferred job_type außerhalb expected_job_type
- Kein Direct-Table-Read im Frontend (UI nur RPC)
- requires_platform_fix Signale werden NIE dispatcht
- blocked_reason Signale werden NIE dispatcht
- TRACKING_NOT_EMITTED bleibt observability-only

## Baseline 2026-05-16
- FANOUT_NOT_STARTED safe in view: 377 (blog 53, og_image 66, indexnow 102, internal_links 156)
- TRACKING_NOT_EMITTED total: 379 (pricing_view 190, checkout_started 189) — alle scope=platform, 0 dispatchable
- Erster Cron-Tick (30min): max 25 dispatches, dann Cooldown 60min pro (pkg×signal×canonical)
- Erwarteter Effekt nach 24h: ~377 fanout signals abgearbeitet wenn keine Producer-Failures

## Tests
`src/components/admin/heal/__tests__/growthLocalWorker.smoke.test.ts`:
- anon→RPC schema-stable (kein 42703/42883/42P01)
- dry_run / live / summary Signatur stabil
- Reason-Guard reportet kein Schema-Drift

## Nächster Schritt
Nach 24h Beobachtung: prüfen ob TRACKING_NOT_EMITTED Counts (379) gefallen sind (Plattform-Pixel-Fix in Code, NICHT in Worker). Lokale FANOUT-Counts sollten messbar fallen.
