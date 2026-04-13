# Memory: architektur/ops/hardened-runner-and-lane-isolation-governance-v2-1-final
Updated: now

## v6.4 Tier Reclassification — Stale-Loop Root Cause Fix

### Problem
Only `handbook_expand_section` and `package_validate_exam_pool` completed. All other job types were trapped in TIMEOUT→STALE_PROCESSING_GUARD→STALE_LOCK_RECOVERY→pending→processing loops. Jobs never reached terminal state.

### Root Cause (v6.4 discovery)
Three jobs were critically misclassified as T4_LIGHT (15s budget):
- `package_validate_blueprint_variants`: N+1 queries on 100+ blueprints → confirmed `TIMEOUT: edge function exceeded 15s`
- `package_elite_harden`: TIME_BUDGET_MS=110s with AI annotation calls → impossible at 15s
- `package_repair_exam_pool_quality`: LLM-assisted repair → HTTP 500 at 15s

Additionally, `fn_reset_stale_processing_jobs` used a **global 5-minute** stale threshold for ALL job types, killing legitimate long-running jobs.

### Fix (v6.4)
1. **Tier reclassification**:
   - `package_elite_harden` → T2_HEAVY (90s budget) — AI annotation with 110s internal budget
   - `package_validate_blueprint_variants` → T3_DEFAULT (45s budget) — bulk DB queries
   - `package_repair_exam_pool_quality` → T3_DEFAULT (45s budget) — LLM repair

2. **Job-type-specific stale thresholds in `fn_reset_stale_processing_jobs`**:
   - T1_GEN / LLM generation: 15 minutes
   - T2_HEAVY / medium jobs: 10 minutes
   - Default: 5 minutes (unchanged)
   - Heartbeat-aware: jobs with heartbeat <3min are never considered stale

3. **Job-type-specific stuck thresholds in `pipeline-process.ts`**:
   - Heavy generators: 20 minutes
   - Medium jobs: 15 minutes
   - Default: 10 minutes

4. **Fresh start**: All stuck jobs reset to pending with 0 attempts

### SSOT Rules
- Timeout tier = budget reservation, NOT max execution time
- Any job completing in <10s MUST be T4_LIGHT (15s budget)
- Jobs with AI/LLM calls MUST be T2_HEAVY (90s) or T1_GEN (120s)
- Jobs with bulk DB queries (100+ rows) should be T3_DEFAULT (45s) minimum
- Stale thresholds MUST be job-type-specific — global 5min kills long-runners
- Heartbeat (<3min fresh) overrides stale detection
