# Memory: architektur/ops/hardened-runner-and-lane-isolation-governance-v2-1-final
Updated: now

## v6.1 Tier Reclassification — BUDGET_EXHAUSTED Root Cause Fix (Final)

### Problem
Only `handbook_expand_section` and `package_exam_rebalance` completed. All other job types were trapped in a BUDGET_EXHAUSTED → STALE_LOCK_RECOVERY → re-claim cycle. v6.0 fix was insufficient because it only moved jobs from T2_HEAVY to T3_DEFAULT, but T3_DEFAULT still requires 30s budget (25s+5s buffer).

### Root Cause (v6.1 discovery)
In v6.0, 7 jobs were moved from T2_HEAVY to T3_DEFAULT. But T3_DEFAULT requires 25s+5s=30s budget. With a 50s loop budget and ~8s boot/claim overhead, after one T3 dispatch at ~30s budget, only ~12s remained — still BUDGET_EXHAUSTED for all subsequent T3 jobs. Additionally, FINISH_LINE_GUARD was blocking `package_run_integrity_check` because 14 stale processing jobs exceeded the cap of 11.

### Fix (v6.1)
1. **Aggressive T4_LIGHT reclassification**: Moved ALL jobs completing in <10s to T4_LIGHT (10s+5s=15s budget):
   - `package_run_integrity_check` (1.5s measured)
   - `package_quality_council` (2-8s actual)
   - `package_elite_harden` (<5s actual)
   - `package_scaffold_learning_course` (3-5s actual)
   - `package_repair_exam_pool_quality` (3-10s actual)
   - `package_auto_seed_exam_blueprints` (<5s actual)

2. **T2_HEAVY reduced further**: Only `package_generate_blueprint_variants` remains. `package_build_ai_tutor_index` moved to T3_DEFAULT.

3. **Stale processing cleanup**: Migration resets processing jobs older than 3 minutes to unblock FINISH_LINE_GUARD caps.

### SSOT Rules
- Timeout tier = budget reservation, NOT max execution time
- Any job completing in <10s MUST be T4_LIGHT (15s budget)
- T3_DEFAULT (30s budget) is for jobs genuinely needing 10-25s
- T2_HEAVY (40s budget) ONLY for jobs genuinely running 20s+
- Over-classification causes systemic starvation via BUDGET_EXHAUSTED cascades
- The 50s loop budget is a hard constraint — with 15s T4 budget, you can dispatch 3 jobs per loop
- Light jobs first within each lane (intra-lane sorting)
