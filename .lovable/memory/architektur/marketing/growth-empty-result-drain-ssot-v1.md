---
name: Growth EMPTY_RESULT Drain SSOT Phase 1
description: fn_drain_stuck_empty_result_growth_jobs(threshold=5,limit=25) DLQs stuck pending growth jobs (seo_internal_links/sitemap_refresh/indexnow_submit) with last_error LIKE 'EMPTY_RESULT%'. Sets last_error_code='DLQ_EMPTY_RESULT_LOOP'. Cron growth-empty-result-drain-15min nutzt denselben SSOT-Pfad. Audit auto_heal_log action_type=growth_empty_result_drain (auch noop). service_role only; cron läuft als postgres (auth.uid IS NULL bypass), admin via has_role-Gate.
type: feature
---

## Why
Worker meldet ok=true, Wrapper klassifiziert als EMPTY_RESULT → endlos retry → Alert-Storm. Phase-1 Cut: deterministisch DLQ statt symptom-Fix der Sitemap/Internal-Link-Handler (Phase 2).

## Contract
- Returns: `{ ok, drained, candidates, threshold, limit, by_type, drained_job_ids }`
- Clamps: threshold≥1, 1≤limit≤500
- Audit jeder Run (drained>0=completed, sonst noop)

## Rollback
```sql
SELECT cron.unschedule('growth-empty-result-drain-15min');
DROP FUNCTION public.fn_drain_stuck_empty_result_growth_jobs(int,int,text);
```

## Smoke 2026-05-11
Initial drain: 0 candidates (vorhandene 2 stuck jobs hatten worker-side schon failed gehit). Funktion + Cron + Audit-Pfad live, wartet auf nächsten EMPTY_RESULT-Loop.
