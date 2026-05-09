---
name: S5c Nightly Aggregate-State Audit + CI Regression Invariants
description: Nightly snapshot of job_queue × package state with diff RPC, plus CI regression suite locking COUNT(*), actor_id, service_role-only access, quarantine-merge, reaper PHK exclusion.
type: feature
---

# S5c — Nightly Audit + Regression Invariants (2026-05-09)

## Storage
- `ops_aggregate_state_audit(run_at, scope, bucket jsonb, n)` — RLS admin-read.
- Bucket dimensions: `package_id, job_type, lane, pool, track, claim_state`.
- Claim-states: PROCESSING_WITHOUT_HEARTBEAT, PROCESSING_WITH_HEARTBEAT, PENDING_DEFERRED, PENDING_CLAIMABLE, FAILED, DONE, CANCELLED.

## RPCs
- `fn_capture_aggregate_state_snapshot(scope)` — service_role only. Logs `aggregate_state_snapshot` to `auto_heal_log`.
- `admin_get_aggregate_state_diff(scope)` — admin only. Compares latest 2 runs, returns top-500 deltas by |Δ|.

## Cron
- `aggregate-state-nightly-audit` — `17 3 * * *` UTC (cron id 195).

## Lockdown
- `fn_reap_stale_processing_jobs(int)` — REVOKE PUBLIC/anon/authenticated; GRANT service_role.

## CI Regression Suite
`src/test/ops/s5c-regression-invariants.test.ts` (11 tests, all green):
1. COUNT(*) — `fn_lane_failure_rate_15m`, `admin_lane_e2e_smoke` parse cleanly.
2. actor_id — `fn_capture_aggregate_state_snapshot` never errors with `actor_uid`.
3. service_role-only — privileged fns refuse anon.
4. admin-only — heal/diagnostic RPCs refuse anon.
5. Aggregate-diff RPC exists and is gated.

## Next (S5b — User flagged)
**Worker First-Heartbeat Contract**: claimed job must write first heartbeat IMMEDIATELY before AI/API/large DB step. Open hotspot if `PROCESSING_WITHOUT_HEARTBEAT` persists post-hotfix.
