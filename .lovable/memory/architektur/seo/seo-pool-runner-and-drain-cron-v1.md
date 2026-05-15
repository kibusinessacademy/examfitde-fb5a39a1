---
name: SEO Pool Runner + Drain Cron v1
description: Eigener Consumer für worker_pool='seo'. Edge seo-pool-runner claimt via claim_pending_jobs_v5(p_worker_pool='seo'), dispatcht an seo-intent-page-generator. Cron 246 alle 5min.
type: feature
---

## Problem
`job_type_policies.seo_intent_page_generate.worker_pool='seo'` — gültig laut Policy, aber pool `seo` hatte keinen Consumer. Default-Runner claimen nur `default`/`prebuild` (siehe SSOT_POOL_RULES.md). Wave-Enqueues blieben pending bis manueller HTTP-Dispatch — Wave 4 Smoke 2026-05-15 18:02 lieferte 2 Jobs ~105min `pending`, started_at=NULL.

## Lösung
**Edge `seo-pool-runner`** (`supabase/functions/seo-pool-runner/index.ts`):
- `claim_pending_jobs_v5(WORKER_ID, batch, 'seo')` → atomic claim (status=processing, started_at, attempts++, locked_by=`seo-pool-runner-<uuid8>`)
- Dispatch je Job an `seo-intent-page-generator` mit `{ job_id }` (Concurrency 3, Batch default 5 / max 10)
- Generator finalisiert (completed/failed/result.page_id). Kein manueller Status-Flip im Runner.
- Audit jede Run: `auto_heal_log action_type=seo_pool_runner_run` mit `result_status=success|partial|noop`, `claimed/dispatched_ok/dispatched_failed/results[]`

**pg_cron `seo-pool-drain-5min`** (jobid 246, `*/5 * * * *`) → POST `/functions/v1/seo-pool-runner` mit `{source:"cron",batch:5}`.

## Smoke 2026-05-15 19:52
2 pending Jobs (FISI + Industriekaufmann Wave-4 Spokes) gedrained:
- attempts=2 (1 runner-claim + 1 generator pre-update — kosmetischer Doppel-Increment, akzeptiert)
- started_at SET, locked_by=`seo-pool-runner-…`, status=completed, result.page_id + quality_score=100
- Kein silent drop, kein direkt-Flip. Idempotenz via `FOR UPDATE SKIP LOCKED` in claim_pending_jobs_v5.

## Bekannte Cosmetics
- attempts wird doppelt inkrementiert (Runner + Generator pre-update). Harmless, max_attempts=25.
- Falls Sub-Cap nötig wird: claim_pending_jobs_v5 hat keinen seo-spezifischen WIP-Cap → ggf. später per phk_caps-Pattern ergänzen.

## Architektur-Lehre
SSOT_POOL_RULES kennt offiziell nur `default`/`prebuild`. `seo` ist de-facto-3. Pool — sollte in der Doku als "Loop C3 SEO" gelistet werden, sonst nächster onboarding-Dev fragt warum.
