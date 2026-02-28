# 🎯 SSOT Pool Rules

> **Pool routing is critical infrastructure.** Incorrect routing causes starvation, timeouts, or system freeze.

---

## 1 — Worker Pools

| Pool | Purpose | Characteristics |
|------|---------|----------------|
| `core` | Lightweight orchestration & DB-bound jobs | Low latency, non-LLM, control-plane |
| `content` | LLM-heavy generation jobs | Long-running, budget-controlled |

---

## 2 — Single Source of Truth

The **only** authoritative source of pool assignment is:

```
supabase/functions/_shared/job-map.ts → JOB_DEFINITIONS[jobType].pool
```

If pool logic is duplicated anywhere else, **it is a bug**.

---

## 3 — Defense-in-Depth (4 Layers)

| Layer | Location | Behavior |
|-------|----------|----------|
| **Enqueue Guard** | `_shared/enqueue.ts` | Throws `SSOT_POOL_GUARD` on mismatch at creation time |
| **Claim Auto-Fix** | `content-runner`, `job-runner` | Auto-corrects pool + sets `meta.pool_autofixed=true` (merge, never overwrite) |
| **Nightly Sweep** | `stuck-scan` | Fixes pending-only mismatches, emits alert, returns `pool_mismatch_fixed` counter |
| **CI Contract Guard** | `scripts/check-pool-contract.ts` | Fails CI if pool drifts from `scripts/job-pool-contract.json` golden snapshot |

---

## 4 — Changing a Pool Assignment

**Required steps (all mandatory):**

1. Update `JOB_DEFINITIONS` in `_shared/job-map.ts`
2. Run `deno run -A scripts/update-pool-contract.ts`
3. Create a backfill migration:
   ```sql
   UPDATE job_queue SET worker_pool = 'new_pool'
   WHERE job_type = '...' AND status IN ('pending','processing');
   ```
4. Deploy
5. Monitor: `pool_autofixed` count, `pool_mismatch_fixed`, content throughput

> ⚠️ **If step 3 is skipped, production may stall.**

---

## 5 — Operational Health Queries

**Detect mismatches:**
```sql
SELECT job_type, worker_pool, COUNT(*)
FROM job_queue WHERE status IN ('pending','processing')
GROUP BY 1,2;
```

**Detect auto-fixes (24h):**
```sql
SELECT job_type,
  COUNT(*) FILTER (WHERE (meta->>'pool_autofixed')::boolean = true)
FROM job_queue WHERE created_at > now() - interval '24 hours'
GROUP BY 1;
```

**Content throughput:**
```sql
SELECT date_trunc('minute', updated_at) AS minute,
  COUNT(*) FILTER (WHERE status='completed') AS completed
FROM job_queue WHERE worker_pool='content'
  AND updated_at > now() - interval '2 hours'
GROUP BY 1 ORDER BY 1 DESC;
```

---

## 6 — Non-Negotiable Rules

- Pool logic may **NEVER** be duplicated.
- Direct SQL inserts into `job_queue` are **forbidden** — use `enqueueJob()`.
- Every job type must exist in the pool contract.
- Drift must fail CI.
- Auto-fix is a safety net, **not a substitute for correctness**.
