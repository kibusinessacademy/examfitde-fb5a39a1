---
name: S5b First-Heartbeat-Contract + CPU-safe Burst v3
description: Worker contract — every claim writes its first heartbeat BEFORE any AI/heavy-DB/external call. PHK-aware adaptive burst caps the 5 control-lane PHK-sensitive job_types to 3 when phk_1h>0. Compliance view + admin RPC + cockpit diff card.
type: feature
---

# S5b — First-Heartbeat-Contract (2026-05-09)

## Forensic baseline (last 30min before deploy)
- 269 failed/cancelled, **0 with heartbeat** → pure PHK signature.
- Top: 85× STALE_LOCK_LOOP_HARD_KILL, 46× PRE_HEARTBEAT_KILL_TERMINAL, 38× STALE_PROCESSING_REAPED.
- Completed in 6h: 13 (5 generation, 8 control) — pipeline reached completion despite collapse.
- Side-finding: 6× `package_auto_publish` HTTP 500 `enum product_track UNKNOWN` (separate bug).

## Contract
Workers call `markFirstHeartbeat(sb, jobId)` from `_shared/first-heartbeat.ts` as their **first action** after `req.json()`, before:
- `assertSchemaReady`, `assertUuid`, `prereqDone`
- any `from("course_packages")` lookup
- any AI / external HTTP call

Idempotent: refreshes `last_heartbeat_at`; `meta.first_heartbeat_at` pinned to the very first call.

## DB
- `mark_job_first_heartbeat(uuid)` — `service_role` only, returns `{ok, first_heartbeat_at, locked_at, lag_ms}`. Skips if not in `processing`.
- `v_first_heartbeat_contract_compliance` — per `(job_type, lane, pool)` last 24h: `claimed_n / with_first_hb / hb_within_30s / phk_signature / completed_n / contract_compliance_pct`.
- `admin_get_first_heartbeat_compliance()` — admin only.
- `fn_adaptive_burst_size_v3(pending, fr, churn, lane, pool, job_type)` — for PHK-sensitive types: returns 3 if `phk_1h>0`, else `LEAST(v2, 8)`.

## PHK-sensitive job_types
1. `package_quality_council`
2. `package_run_integrity_check`
3. `package_auto_publish`
4. `package_validate_tutor_index`
5. `package_build_ai_tutor_index`

## UI
`AggregateStateDiffCard` in HealCockpit Diagnostics-Tab — Top-50 deltas across nightly snapshots, filterable.

## CI
`src/test/ops/s5b-first-heartbeat-contract.test.ts` (8/8):
- RPC contract (anon-refused, no syntax errors)
- Static worker contract per file: `markFirstHeartbeat` import + handler-scope call BEFORE `prereqDone / assertSchemaReady / assertUuid / from("course_packages")`.

## Open
- v3 not yet wired into `claim_pending_jobs_v5` / `fn_auto_recovery_pulse_decide` (next pass).
- `enum product_track UNKNOWN` 500 in auto-publish (separate ticket).
