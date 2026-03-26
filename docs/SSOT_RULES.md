# SSOT Rules — Exam Question Semantics

> **Owner:** Architecture / Pipeline  
> **Last updated:** 2026-03-14  
> **Canonical source:** This file + `v_exam_relevant_questions` (DB view)

---

## Three Semantic Tiers

When querying `exam_questions`, there are exactly **three** valid semantic tiers.  
Every consumer MUST use the correct tier. **No ad-hoc filters.**

### 1. `existence` — "Does anything exist?"

| Purpose | Check if generation has started / rows exist at all |
|---------|------------------------------------------------------|
| Filter  | `count(*) FROM exam_questions WHERE ...`             |
| Use by  | `artifact-resolver` (existence checks), fan-out start conditions |
| Includes | All statuses, all `qc_status` values |

**Rule:** Only use for "has generation started?" — never for target/yield calculations.

---

### 2. `exam_relevant` — "Is it countable toward the exam target?"

| Purpose | Count questions that are usable or on track for the exam pool |
|---------|---------------------------------------------------------------|
| Filter  | `v_exam_relevant_questions` (view) or `count_exam_relevant()` (RPC) |
| Definition | `status != 'rejected' AND qc_status NOT IN ('tier1_failed', 'rejected')` |
| Use by  | Fan-out planner, post-conditions, drift-finder, auto-gap-close, stuck-scan, reconcile |

**Rule:** This is the **default** tier. If unsure, use this one.  
**Anti-pattern:** Writing `SELECT count(*) FROM exam_questions WHERE status = 'approved'` manually — use the view/RPC instead.

**Canonical DB objects:**
- View: `v_exam_relevant_questions`
- RPC: `count_exam_relevant(p_curriculum_id, p_learning_field_id?)`
- RPC: `get_exam_question_counts_by_lf(p_curriculum_id, p_lf_ids)`

---

### 3. `validated_exam_pool` — "Is it publish-ready?"

| Purpose | Strict validation for publish gate / elite hardening |
|---------|------------------------------------------------------|
| Filter  | `status = 'approved' AND qc_status = 'approved'` (+ additional quality constraints) |
| Use by  | `package-auto-publish` (publish gate), `mfa-elite-hardening` (elite checks) |
| Includes | Only fully validated, approved questions |

**Rule:** Only use when making a **publish/release decision**. This is intentionally stricter than `exam_relevant`.

**Additional publish-gate constraints** (enforced in code):
- Min 500 approved questions (`EXAM_POOL`)
- Min 40% hard/very_hard (`HARDISH_TOO_LOW`)
- Min 12% UNDERSTAND bloom level (`BLOOM_GATE`)
- Max 30% isolated context (`ELITE_CONTEXT`)

---

## Guard Rules

1. **Never count `exam_questions` directly** in Edge Functions or client code without using the view or RPC — the `ssot-guard` CI script will flag this.
2. **Never add a new filter definition** that redefines "exam-relevant" — extend the view if the definition must change.
3. **If the view definition changes**, all three tiers must be reviewed for consistency.

---

## Decision Tree

```
Need to count exam questions?
│
├─ "Has generation started at all?" → Tier 1 (existence): direct count, any status
│
├─ "How many toward the target?" → Tier 2 (exam_relevant): use v_exam_relevant_questions / count_exam_relevant()
│
└─ "Ready to publish?" → Tier 3 (validated_exam_pool): approved + quality gates
```

---

## Step Progress SSOT

> **Added:** 2026-03-26  
> **Canonical source:** `v_package_progress_ssot` (DB view)

### Rule: No consumer may calculate step progress independently.

All step-based progress metrics **MUST** be sourced from `v_package_progress_ssot`.

**Canonical columns:**

| Column | Definition |
|--------|-----------|
| `steps_done` | `count(*) FILTER (WHERE status = 'done')` |
| `steps_functional` | `count(*) FILTER (WHERE status <> 'skipped')` — the **only valid denominator** |
| `steps_skipped` | `count(*) FILTER (WHERE status = 'skipped')` |
| `progress_pct` | `round(steps_done * 100.0 / steps_functional)` |

**Anti-patterns (CI Guard 6 will flag these):**
- `count(*) AS total_steps` from `package_steps` directly
- `steps.length` / `totalSteps` in frontend code
- Any `/ total_steps * 100` calculation outside the canonical view

**Why?** `skipped` steps must be excluded from the denominator. Mixing raw `count(*)` with the SSOT `build_progress` field produces phantom drift (e.g. 96% shown as 24/41 instead of 24/25).

**Invariant (DB-enforced):**
`course_packages.build_progress == v_package_progress_ssot.progress_pct` — at all times, protected by trigger `trg_guard_build_progress_drift`.

### Decision Tree

```
Need step progress?
│
├─ UI counter (X/Y steps) → v_package_progress_ssot.steps_done / steps_functional
│
├─ Progress percentage → v_package_progress_ssot.progress_pct
│
├─ Deadlock / repair classification → JOIN v_package_progress_ssot
│
└─ Raw step audit → direct package_steps query OK (but never for progress %)
```
