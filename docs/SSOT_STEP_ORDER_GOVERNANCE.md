# SSOT_STEP_ORDER_GOVERNANCE.md

## Purpose

Pipeline step ordering and dependencies are critical infrastructure.
Wrong ordering causes silent skips, zombie steps, or non-deterministic builds.

This document defines the SSOT rules for:
- Step keys
- Step ordering
- Step → Job mapping
- Step dependency graph (DAG)
- Enforcement (CI + runtime)

---

## SSOT Sources (Binding)

All pipeline truth lives in:

- `supabase/functions/_shared/job-map.ts`
  - `PipelineStepKey`
  - `STEP_TO_JOB_TYPE`
  - `FULL_STEP_ORDER`
  - `PIPELINE_GRAPH`

No other file may define:
- a different step order,
- missing steps,
- alternate step → job mappings,
- or step dependencies.

If duplicated elsewhere, it is a bug.

---

## Invariants (Non-negotiable)

### A) Completeness
- Every `PipelineStepKey` MUST exist in:
  - `STEP_TO_JOB_TYPE`
  - `FULL_STEP_ORDER`
  - `PIPELINE_GRAPH`

### B) Order is topologically valid
`FULL_STEP_ORDER` MUST be a valid topological order of `PIPELINE_GRAPH`.
(For every dependency `A dependsOn B`, B must appear before A.)

### C) Step mapping is stable
If a step key exists, it must map deterministically to exactly one `job_type`.

### D) Package steps are a subset
A package may omit steps; omitted steps are skipped.
But if a package contains a step, it MUST exist in SSOT and satisfy dependency requirements.

---

## Enforcement (Defense in Depth)

### Layer 1 — Build-time validation (CI)
`scripts/edge-guards.ts` includes guards that:
- Validate completeness (A)
- Validate topological order (B)
- Validate mapping stability (C)

CI fails on drift.

### Layer 2 — Runner boot-time validation
`pipeline-runner` and `build-course-package` validate that:
- every DB `package_steps.step_key` exists in SSOT
- step order used by runner equals SSOT `FULL_STEP_ORDER`

### Layer 3 — stuck-scan hygiene
If a step exists in DB but not in SSOT:
- mark job as failed with reason `SSOT_STEP_UNKNOWN`
- notify ops

---

## How to Add a Step (Required Procedure)

1. Add key to `PipelineStepKey`
2. Add mapping in `STEP_TO_JOB_TYPE`
3. Add key in `FULL_STEP_ORDER` at the correct position
4. Add node to `PIPELINE_GRAPH` with dependencies + artifacts
5. Ensure job_type exists in `JOB_DEFINITIONS` (pool + edgeFunction routing)
6. Update `scripts/job-pool-contract.json` (`npm run pool:contract:update`)
7. Run CI (must pass)

If any step is skipped, CI must fail.

---

## Operational Queries

### Unknown steps in DB (should be 0)
SSOT: `supabase/functions/_shared/job-map.ts` → `FULL_STEP_ORDER` (29 Steps).
Wenn dieser Query Werte zurückgibt: entweder neuen Step in `FULL_STEP_ORDER` + diesem Query aufnehmen, oder DB bereinigen.

```sql
SELECT DISTINCT step_key
FROM package_steps
WHERE step_key IS NOT NULL
  AND step_key NOT IN (
    -- Phase 1: Learning Content (Steps 1–6)
    'scaffold_learning_course','generate_glossary','fanout_learning_content',
    'generate_learning_content','finalize_learning_content','validate_learning_content',
    -- Phase 2: Exam Pool (Steps 7–14)
    'auto_seed_exam_blueprints','validate_blueprints',
    'generate_blueprint_variants','validate_blueprint_variants','promote_blueprint_variants',
    'generate_exam_pool','validate_exam_pool','repair_exam_pool_quality',
    -- Phase 3: Tutor & Oral (Steps 15–18)
    'build_ai_tutor_index','validate_tutor_index',
    'generate_oral_exam','validate_oral_exam',
    -- Phase 4: Minichecks & Handbook (Steps 19–25)
    'generate_lesson_minichecks','validate_lesson_minichecks',
    'generate_handbook','validate_handbook',
    'enqueue_handbook_expand','expand_handbook','validate_handbook_depth',
    -- Phase 5: Gates & Publish (Steps 26–29)
    'elite_harden','run_integrity_check','quality_council','auto_publish'
  );
```

