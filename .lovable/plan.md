
## Reality reconciliation (before we touch anything)

The "248" denominator = `products` with `status='active' AND visibility='public' AND curriculum_id NOT NULL`. The 192 sellable count comes from `v_public_sellable_courses`, which requires for each priced product **all of**:

1. a `courses` row with same `curriculum_id` and `status='published'`,
2. at least one published `course_packages` row on that curriculum whose `v_lessons_gap_ssot.classification IN ('HAS_READY','EXEMPT')`.

Measured baseline today:

```text
products active+public+curriculum     248
courses    published                   241
course_packages published              193
v_public_sellable_courses rows         241
  is_sellable=true                     192
  not sellable, lessons>0 ready=0       23
  not sellable, modules=0|lessons=0     10
  not sellable, other lesson blocker    16
v_lessons_gap_ssot (published pkgs)
  HAS_READY                            153
  EXEMPT                                39
  NO_MODULES                             1
```

Conclusion: the 56-package gap is **not** a pricing/Stripe/visibility issue. It is a content-pipeline + bridge issue, split across three lanes.

## Lane A — Lesson-Readiness Heal (23 + 16 = up to 39 candidates)

Targets curricula where a published `course_packages` row exists but no lesson is `ready` / `completed`.

- Use the **existing QC gate** `admin_course_auto_heal_queue` (the only sanctioned approval pathway). No direct `UPDATE lessons SET status='ready'`.
- For each candidate `(course_id, curriculum_id)`, enqueue a heal job of type `lesson_readiness_recheck` that runs the lesson generator's completion verifier. Lessons already produced by the factory but stuck in `draft` because `generation_status≠'completed'` are the realistic recoverable subset.
- Anything the QC gate refuses → stays blocked and is reported back. No bypass.
- Audit row per enqueue into `auto_heal_log` with `action_type='sellable_recovery_lesson_recheck'`.

## Lane B — Empty Published Course Demote (10 candidates)

Empty published courses cannot be auto-healed without inventing content → demote, not heal.

- Call existing SSOT RPC `admin_demote_empty_course(course_id, 'sellable_recovery_batch_1')` per candidate.
- Course leaves the `published` cohort, drops out of `v_public_sellable_courses`, and the underlying priced product gets a corresponding entry in `admin_course_auto_heal_queue` so content factory can re-attempt later.
- Audit per row into `auto_heal_log` with `action_type='sellable_recovery_empty_demote'`.

## Lane C — Product / Package Bridge (the real "missing-from-view" cohort)

55 priced products do not have a corresponding published `course_packages` row on their curriculum. Two sub-cases:

C1. A `course_packages` row exists on that curriculum but is not `status='published'` AND the curriculum is already `HAS_READY` in `v_lessons_gap_ssot` (i.e. content exists, only the package is unpublished). → publish via existing RPC `admin_publish_course_package(package_id)` which itself runs the publish-guard. If the guard refuses, it stays blocked.

C2. No `course_packages` row at all for the curriculum → enqueue `admin_course_auto_heal_queue` with `reason='missing_package_for_priced_product'`. **Do not** create a stub package by hand.

Audit: `action_type='sellable_recovery_bridge_publish'` resp. `sellable_recovery_bridge_enqueue`.

## Deliverable — Before/After Report

Single edge function `sellable-recovery-batch` (admin-only, JWT-verified, dry-run by default) that:

1. Snapshots the baseline counts (the table above) into `auto_heal_log` with `action_type='sellable_recovery_snapshot_before'`.
2. Executes Lanes A, B, C with `dry_run` toggle.
3. Re-reads the same counts and writes `sellable_recovery_snapshot_after`.
4. Returns JSON:

```text
{
  before: { total_products, view_rows, sellable, lane_a, lane_b, lane_c1, lane_c2 },
  after:  { ...same fields },
  actions: { lane_a_enqueued, lane_b_demoted, lane_c1_published, lane_c2_enqueued, refused_by_gate },
  remaining_blockers: [ { product_id, curriculum_id, reason } … ]
}
```

UI: extend `/admin/governance/sell-health` with a "Sellable Recovery" card that shows the latest snapshot pair and a (dry-run | execute) trigger button. No new route, no new table.

## Process guardrail (so this drift cannot silently re-open)

Root cause of the drift: a priced public product can be created/activated without a corresponding **published** `course_packages` row, and a `course_packages` row can be published while its underlying lessons never reach `ready`. Today these two states are checked only retroactively by the sell-health cockpit.

Add two minimal preventive guards (no new architecture, only DB triggers + a daily cron):

1. **Trigger `trg_priced_product_requires_publishable_package`** on `product_prices` INSERT/UPDATE → if `active=true` and product is `visibility='public'`, require either an existing published `course_packages` row on the curriculum **or** an open `admin_course_auto_heal_queue` entry with `reason='missing_package_for_priced_product'`. Otherwise auto-create the queue entry and write `auto_heal_log` action `sell_drift_prevent_priced_orphan`. Does **not** block the price write — it only guarantees the heal queue is non-empty so the daily reaper picks it up.
2. **Daily cron `sellable-recovery-reaper`** at 04:42 UTC: re-runs the recovery batch in dry-run, and if `remaining_blockers > 0 AND remaining_blockers_delta_7d ≥ 0` emits an alert into `management_alerts` with severity high. This converts "we silently lost 56 sellables" into a paged signal within 24h.

Both guards reuse existing tables — no new audit surface, satisfies ARCHITECTURE_INVARIANT NO_REGRESSION_GUARD + BRIDGE_REQUIRED.

## Execution order

1. Migration: triggers + cron (guardrail first, so heal does not re-open drift while we work).
2. Edge function `sellable-recovery-batch` deployed in dry-run default.
3. Run dry-run → review counts with you.
4. Run execute → publish report.
5. Update memory leaf `.lovable/memory/features/sellable-recovery-batch-1.md`.

## What this plan explicitly does **not** do

- No `UPDATE lessons SET status='ready'` outside the QC gate.
- No `INSERT INTO lessons` / dummy content.
- No `product_prices` / `products.visibility` / stripe price changes.
- No new "shadow" sellable view.
- No promise of 248/248 — final number is whatever the QC gate + factory accept, and the report names every remaining blocker by product_id.
