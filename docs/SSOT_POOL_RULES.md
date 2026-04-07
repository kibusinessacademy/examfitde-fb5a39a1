# 🎯 SSOT Pool Rules

> **Pool routing is critical infrastructure.** Incorrect routing causes starvation, timeouts, or system freeze.

---

## 1 — Worker Pools

| Pool | Purpose | Characteristics |
|------|---------|----------------|
| `default` | Standard runner pool — orchestration, validation, and generation | All non-variant jobs |
| `prebuild` | Variant materialization pool | Blueprint variant generation, validation, promotion |

> ⚠️ **Legacy pools `core` and `content` are DEPRECATED and MUST NOT be used.** The DB trigger `trg_guard_sync_worker_pool` auto-corrects any legacy pool assignments to the DB-SSOT value.

---

## 2 — Single Source of Truth (SSOT Hierarchy)

| Priority | Source | Role |
|----------|--------|------|
| **1 (Authority)** | `job_type_policies.worker_pool` (DB) | Runtime authority. The trigger enforces this on every INSERT/UPDATE. |
| **2 (Contract)** | `scripts/job-pool-contract.json` | CI golden snapshot — must mirror DB. |
| **3 (Code)** | `supabase/functions/_shared/job-map.ts → JOB_DEFINITIONS[jobType].pool` | Code reference — must match contract. |

If pool logic is duplicated or contradicts the DB, **it is a bug**.

---

## 3 — Defense-in-Depth (5 Layers)

| Layer | Location | Behavior |
|-------|----------|----------|
| **DB Trigger Guard** | `trg_guard_sync_worker_pool` on `job_queue` | Auto-corrects pool to DB-SSOT on every INSERT/UPDATE. Logs correction in `meta.pool_autosynced`. |
| **Enqueue Guard** | `_shared/enqueue.ts` | Throws `SSOT_POOL_GUARD` on mismatch at creation time |
| **Claim Auto-Fix** | `content-runner`, `job-runner` | Auto-corrects pool + sets `meta.pool_autofixed=true` (merge, never overwrite) |
| **Nightly Sweep** | `stuck-scan` | Fixes pending-only mismatches, emits alert, returns `pool_mismatch_fixed` counter |
| **CI Contract Guard** | `scripts/check-pool-contract.ts` | Fails CI if pool drifts from contract OR uses legacy pools (`core`/`content`) |

---

## 4 — Changing a Pool Assignment

**Required steps (all mandatory):**

1. Update `job_type_policies` in the **database** (migration)
2. Update `JOB_DEFINITIONS` in `_shared/job-map.ts` to match
3. Run `deno run -A scripts/update-pool-contract.ts` to regenerate the contract
4. Create a backfill migration:
   ```sql
   UPDATE job_queue SET worker_pool = 'new_pool'
   WHERE job_type = '...' AND status IN ('pending','processing');
   ```
5. Deploy
6. Monitor: `pool_autosynced` count, `pool_mismatch_fixed`, throughput

> ⚠️ **If step 1 is skipped, the DB trigger will override your code changes.**
> ⚠️ **If step 4 is skipped, production may stall until the trigger fires on next UPDATE.**

---

## 5 — Operational Health Queries

**Detect mismatches (should always return 0 rows):**
```sql
SELECT jq.job_type, jq.worker_pool AS queue_pool, jtp.worker_pool AS policy_pool, COUNT(*)
FROM job_queue jq
JOIN job_type_policies jtp ON jtp.job_type = jq.job_type
WHERE jq.status IN ('pending','processing')
  AND COALESCE(jq.worker_pool,'default') != COALESCE(jtp.worker_pool,'default')
GROUP BY 1,2,3;
```

**Detect auto-syncs (24h) — should trend toward 0:**
```sql
SELECT job_type,
  COUNT(*) FILTER (WHERE (meta->>'pool_autosynced')::boolean = true)
FROM job_queue WHERE created_at > now() - interval '24 hours'
GROUP BY 1 HAVING COUNT(*) FILTER (WHERE (meta->>'pool_autosynced')::boolean = true) > 0;
```

**Detect legacy pool usage in code (should return 0):**
```sql
SELECT job_type, worker_pool FROM job_queue
WHERE worker_pool IN ('core', 'content') AND status IN ('pending','processing');
```

---

## 6 — Non-Negotiable Rules

- **`job_type_policies` is the sole pool authority.** Code may reference pools but MUST NOT override the DB.
- Pool logic may **NEVER** be duplicated outside the DB trigger.
- Only `default` and `prebuild` are valid pools. Legacy `core`/`content` are auto-corrected.
- Direct SQL inserts into `job_queue` are **forbidden** — use `enqueueJob()`.
- Every job type must exist in the pool contract.
- Drift must fail CI.
- Auto-sync is a safety net, **not a substitute for correctness**.
