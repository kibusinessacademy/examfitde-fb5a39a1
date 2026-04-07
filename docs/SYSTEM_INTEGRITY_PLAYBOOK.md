# SYSTEM_INTEGRITY_PLAYBOOK.md

## Goal

Keep ExamFit pipeline production-safe: deterministic, drift-resistant, self-healing, observable.

---

## 4-Level Guard Taxonomy

Every guard must cover **operational executability**, not just structural consistency.

| Level | Name | Question Answered | Examples |
|-------|------|-------------------|----------|
| **L1** | Schema / Registry Guards | _Does everything exist?_ | DAG parity, handler-registry-parity, job_type_policies completeness |
| **L2** | Dispatch / Pool Guards | _Can the runner actually claim it?_ | Pool alignment (code↔DB), runner boot pool guard, claim RPC signature guard |
| **L3** | Runtime Health Guards | _Is it being processed in production?_ | No-claim-despite-backlog, stuck-type detection (pending>0, completed=0) |
| **L4** | Anomaly Guards | _Are there systematic failure patterns?_ | Hot-loop guard (>50 jobs, no progress), auto-fix rate threshold (>10/day = incident) |

**Key Lesson (Incident 2026-04):** L1+L2 guards passed while the system was operationally dead. The runner claimed pool `content`, the DB trigger silently normalized all jobs to pool `default`. No guard checked whether the runner's claim pool matched the DB SSOT. Detection required L2 (pool alignment) and L3 (stuck-type) guards, which have since been added.

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
6. **Runner boot must hard-fail** if claim pools don't exist in DB SSOT.
7. **Post-deploy smoke test must validate** all 4 guard levels, not just L1.

---

## Guard Inventory

### L1: Schema / Registry
- `handler-registry-parity-guard.mjs` (CI) — every DB job_type has code handler
- `DAG Parity Guard` (CI) — step_dag_edges ↔ PIPELINE_GRAPH
- `fn_guard_no_rpc_overloads` (DB) — no ambiguous RPC signatures

### L2: Dispatch / Pool
- **Runner Boot Pool Guard** (runtime) — hard-fail if claim pool ∉ DB SSOT
- **Pool Alignment Check** (smoke test) — code pool ↔ DB pool per job_type
- `trg_guard_sync_worker_pool` (DB trigger) — auto-correct + alert threshold

### L3: Runtime Health
- **No-Claim-Despite-Backlog** (smoke test) — pending_ready>5, processing=0, completed_15m=0
- **Stuck-Type Detection** (smoke test + ops UI) — pending>2, completed_24h=0
- **StuckJobTypeAlert** (admin dashboard) — visual warning

### L4: Anomaly
- **Hot-Loop Guard** — freeze steps with >50 jobs, no status change
- **Auto-Fix Rate Threshold** — >10 pool auto-syncs/day = incident
- **Model Drift Check** (smoke test) — forbidden models in critical pipelines

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
WHERE worker_pool='default'
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

### E) Operational dead-stop detection (NEW)
```sql
SELECT
  (SELECT COUNT(*) FROM job_queue WHERE status='pending' AND run_after <= now()) AS pending_ready,
  (SELECT COUNT(*) FROM job_queue WHERE status='processing') AS processing,
  (SELECT COUNT(*) FROM job_queue WHERE status='completed' AND updated_at > now() - interval '15 minutes') AS completed_15m;
-- ALERT if: pending_ready > 5 AND processing = 0 AND completed_15m = 0
```

---

## Incident Response (Runbook)

### Symptom: content-runner idle but pending jobs exist
1. Check pool mismatches (L2 guard)
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
1. **Check pool alignment first** (most common root cause):
   ```sql
   SELECT DISTINCT worker_pool FROM job_queue WHERE status = 'pending';
   -- Compare with runner's RUNNER_CLAIM_POOLS constant
   ```
2. Check for RPC overloads:
   ```sql
   SELECT * FROM fn_guard_no_rpc_overloads();
   ```
   Expected: 0 rows. If >0, drop the duplicate signature.
3. Check content-runner logs for `claim error` or `BOOT_GUARD`:
   ```sql
   -- Edge function logs: search "BOOT_GUARD" or "claim error" in content-runner
   ```
4. Test claim function directly:
   ```sql
   SELECT * FROM claim_pending_jobs_v4('test-worker', 1, 5, 'default');
   ```
   If error → function is broken (schema drift, column mismatch, overload).
5. Verify job_queue columns match function expectations:
   ```sql
   SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='job_queue';
   ```
6. After fix, verify at least 1 job transitions to `processing` within 2 minutes.

### Symptom: Repair/validation jobs cancelled unexpectedly
1. Check `job_type_policies` table for correct flags:
   ```sql
   SELECT * FROM job_type_policies WHERE can_run_when_not_building OR exempt_from_auto_cancel;
   ```
2. Ensure new repair job types are registered with correct policies.

---

## Post-Deploy Smoke Test Dimensions

The `admin-deploy-smoke-check` edge function validates 5 dimensions:

| # | Dimension | Level | What it catches |
|---|-----------|-------|-----------------|
| 1 | Model Drift | L4 | Forbidden models in critical pipelines |
| 2 | Handler Registry | L1 | DB job_types without code handlers |
| 3 | Claim Health | L3 | Job types stuck: pending>0, completed=0 |
| 4 | No-Claim-Despite-Backlog | L3 | Operational dead-stop: backlog exists but nothing processes |
| 5 | Pool Alignment | L2 | Code pool ≠ DB pool per job_type |

---

## Governance Pattern (Blueprint)

For each critical subsystem use:

**SSOT → Contract → CI Guard → Runtime Guard → Sweep → Metrics**

Implemented:
- ✅ Pool governance (L1+L2)
- ✅ Step order governance (L1)
- ✅ Budget governance (L1)
- ✅ Concurrency governance (L1)
- ✅ Job outcome classification (blocked vs transient vs permanent)
- ✅ Auto-publish readiness gate (integrity_passed guard)
- ✅ Exponential backoff with jitter for transient failures
- ✅ Job type policy governance (central `job_type_policies` table)
- ✅ RPC overload guard (`fn_guard_no_rpc_overloads`) (L1)
- ✅ Claim-time package status guard (L2)
- ✅ Auto-cancel on package exit trigger
- ✅ Attempt-safe deferred retry (`fn_return_job_to_pending_no_burn`)
- ✅ Runner boot pool guard (L2) — hard-fail on pool mismatch
- ✅ No-claim-despite-backlog detection (L3)
- ✅ Stuck-type alert (L3+L4)
- ✅ Handler-registry parity CI guard (L1)

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

---

## Incident Postmortem: Pool Mismatch Silent Standstill (2026-04)

**Duration:** ~2+ weeks undetected

**Problem:** 14+ job types (integrity_check, quality_council, auto_publish, etc.) had 0 completions despite pending backlog. Pipeline appeared "green" to all existing monitors.

**Root Cause:** Runner claimed pool `content`; DB trigger `trg_guard_sync_worker_pool` silently normalized all jobs to pool `default`. The RPC `claim_pending_jobs_v4` filtered strictly on pool name → 0 matches → "Claimed 0" (no error).

**Why undetected:**
- CI guards checked structural parity (L1) but not operational executability (L2/L3)
- Deploy smoke test checked model drift (L4) but not claim health (L3)
- DB trigger healed silently with no alert threshold
- Runner logged "Claimed 0" without exception
- No stuck-type signal existed (pending>0 ∧ completed=0)

**Fix:** Pool alignment correction + 4-level guard taxonomy implementation.

**Lesson:** Guards must cover all 4 levels. Structural consistency ≠ production effectiveness.
