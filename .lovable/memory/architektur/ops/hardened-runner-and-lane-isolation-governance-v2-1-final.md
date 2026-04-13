# Memory: architektur/ops/hardened-runner-and-lane-isolation-governance-v2-1-final
Updated: now

## v6.0 Tier Reclassification — BUDGET_EXHAUSTED Root Cause Fix

### Problem
Only `handbook_expand_section` and `package_exam_rebalance` completed. All other job types were trapped in a BUDGET_EXHAUSTED → STALE_LOCK_RECOVERY → re-claim cycle.

### Root Cause
In v5.1, 6 control/validation jobs were over-promoted to T2_HEAVY (requires 35s+5s=40s budget). With a 50s loop budget and ~8s boot/claim overhead, only ~42s remained. After parallel T2_HEAVY dispatch consumed 35s, all subsequent lanes got < 10s → BUDGET_EXHAUSTED for every remaining job. Only jobs completing in <3s (handbook_expand, exam_rebalance) survived.

### Fix (v6.0)
1. **Tier reclassification**: Removed 6 jobs from T2_HEAVY that actually complete in 1-5s:
   - `package_run_integrity_check` → T3_DEFAULT (1-3s actual)
   - `package_quality_council` → T3_DEFAULT (2-8s actual)
   - `package_promote_blueprint_variants` → T4_LIGHT (<2s actual)
   - `package_validate_exam_pool` → T4_LIGHT (<3s actual)
   - `package_scaffold_learning_course` → T3_DEFAULT
   - `package_elite_harden` → T3_DEFAULT
   - `package_repair_exam_pool_quality` → T3_DEFAULT

2. **Intra-lane sorting**: Jobs within each lane sorted by tier (light→default→heavy) to maximize completions before budget exhaustion.

3. **T2_HEAVY restricted to**: Only `package_generate_blueprint_variants` and `package_build_ai_tutor_index` — jobs that genuinely need 30s+.

### SSOT Rules
- Timeout tier = MAX time the edge function COULD take, not what it usually takes
- T2_HEAVY (40s required budget) must ONLY be used for jobs that genuinely run 20s+
- Over-classification causes systemic starvation via BUDGET_EXHAUSTED cascades
- The 50s loop budget is a hard constraint — budget arithmetic must be validated
- Zur Vermeidung von Starvation: Light jobs first, heavy jobs last within each lane
