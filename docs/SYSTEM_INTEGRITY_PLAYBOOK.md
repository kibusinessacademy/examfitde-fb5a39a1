# SYSTEM_INTEGRITY_PLAYBOOK.md

## Goal

Keep ExamFit pipeline production-safe: deterministic, drift-resistant, self-healing, observable.

---

## Core SSOT Modules

| Module | Purpose |
|--------|---------|
| `_shared/job-map.ts` | Steps, DAG, pool routing, job definitions |
| `_shared/enqueue.ts` | Enqueue guard (pool validation) |
| `_shared/time-budget.ts` | Edge time budgets |
| `_shared/worker-config.ts` | Runner concurrency governance |

---

## Non-Negotiable Invariants

1. **SSOT is the only truth.** No duplication.
2. **CI must fail on drift.** Guards 1–9 enforce this.
3. **Runners must never hardcode pool/budget/concurrency.**
4. **No direct `job_queue.insert`** — use `enqueueJob()`.
5. **Every new job type must:**
   - exist in `JOB_DEFINITIONS`
   - exist in pool contract
   - have known budget + runner behavior

---

## Daily Ops Checks (5 minutes)

### A) Pool routing drift (should be 0)
```sql
SELECT job_type, worker_pool, COUNT(*)
FROM job_queue
WHERE status IN ('pending','processing')
GROUP BY 1,2;
```

### B) Auto-fix rate (should be 0)
```sql
SELECT job_type,
  COUNT(*) FILTER (WHERE (meta->>'pool_autofixed')::boolean = true) AS autofixed
FROM job_queue
WHERE created_at > now() - interval '24 hours'
GROUP BY 1
ORDER BY autofixed DESC;
```

### C) Content throughput
```sql
SELECT date_trunc('minute', updated_at) AS minute,
  COUNT(*) FILTER (WHERE status='completed') AS completed
FROM job_queue
WHERE worker_pool='content'
  AND updated_at > now() - interval '2 hours'
GROUP BY 1
ORDER BY 1 DESC;
```

### D) Failures by type
```sql
SELECT job_type, COUNT(*) AS failed_cnt
FROM job_queue
WHERE status='failed'
  AND created_at > now() - interval '12 hours'
GROUP BY 1
ORDER BY failed_cnt DESC;
```

---

## Incident Response (Runbook)

### Symptom: content-runner idle but pending jobs exist
1. Check pool mismatches
2. Check leases
3. Check `claim_pending_jobs_v4` output
4. Check budgets/timeouts
5. Reduce `claimLimit` to 1 (safe mode)
6. Re-run

### Symptom: system freeze / starvation
1. Identify top `job_type` dominating core pool
2. Verify pool contract + `JOB_DEFINITIONS`
3. Run stuck-scan sweep
4. Check any concurrency changes
5. Rollback concurrency or budgets

### Symptom: repeated backoff loops
1. Examine `last_error` distribution
2. Lower per-invocation chunk sizes
3. Ensure `shouldSoftStop()` is respected
4. Ensure idempotency keys prevent repeats

### Symptom: Claim Starvation (pending > 0, processing = 0, runner alive)
1. Check for RPC overloads:
   ```sql
   SELECT * FROM fn_guard_no_rpc_overloads();
   ```
   Expected: 0 rows. If >0, drop the duplicate signature.
2. Check content-runner logs for `claim error`:
   ```sql
   -- Edge function logs: search "claim error" in content-runner
   ```
3. Test claim function directly:
   ```sql
   SELECT * FROM claim_pending_jobs_v4('test-worker', 1, 5, 'content');
   ```
   If error → function is broken (schema drift, column mismatch, overload).
4. Verify job_queue columns match function expectations:
   ```sql
   SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='job_queue';
   ```
5. After fix, verify at least 1 job transitions to `processing` within 2 minutes.

### Symptom: Repair/validation jobs cancelled unexpectedly
1. Check `job_type_policies` table for correct flags:
   ```sql
   SELECT * FROM job_type_policies WHERE can_run_when_not_building OR exempt_from_auto_cancel;
   ```
2. Ensure new repair job types are registered with correct policies.

---

## Governance Pattern (Blueprint)

For each critical subsystem use:

**SSOT → Contract → CI Guard → Runtime Guard → Sweep → Metrics**

Implemented:
- ✅ Pool governance
- ✅ Step order governance
- ✅ Budget governance
- ✅ Concurrency governance
- ✅ Job outcome classification (blocked vs transient vs permanent)
- ✅ Auto-publish readiness gate (integrity_passed guard)
- ✅ Exponential backoff with jitter for transient failures
- ✅ Job type policy governance (central `job_type_policies` table)
- ✅ RPC overload guard (`fn_guard_no_rpc_overloads`)
- ✅ Claim-time package status guard
- ✅ Auto-cancel on package exit trigger
- ✅ Attempt-safe deferred retry (`fn_return_job_to_pending_no_burn`)

---

## Change Management (Mandatory)

For changes to pools, step ordering, runner configs, or budgets:

1. Update SSOT module
2. Update contract if applicable
3. Add backfill migration if needed
4. Deploy
5. Run `SELECT * FROM fn_guard_no_rpc_overloads()` — must return 0 rows
6. Run live checks
7. Monitor 24h

For changes to critical RPCs (`claim_pending_jobs_v4`, `acquire_next_package_lease_v2`):

1. Always use `CREATE OR REPLACE`, never additive `CREATE FUNCTION`
2. Verify column references against actual schema before deployment
3. Run canary claim test post-deployment
4. Check content-runner logs for claim errors within 5 minutes
