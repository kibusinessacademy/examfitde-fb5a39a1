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

---

## Change Management (Mandatory)

For changes to pools, step ordering, runner configs, or budgets:

1. Update SSOT module
2. Update contract if applicable
3. Add backfill migration if needed
4. Deploy
5. Run live checks
6. Monitor 24h
