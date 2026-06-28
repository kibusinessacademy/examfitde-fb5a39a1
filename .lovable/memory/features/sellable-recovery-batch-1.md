---
name: SELLABLE.RECOVERY.BATCH.1
description: Sellable recovery batch + prevention guard for priced public products without published course package
type: feature
---

# Sellable Recovery Batch

**Denominator** for "X/248 sellable" = `products WHERE status='active' AND visibility='public' AND curriculum_id NOT NULL`.

**Sellable** = `v_public_sellable_courses.is_sellable = true` (requires published course + published course_package with `v_lessons_gap_ssot.classification IN ('HAS_READY','EXEMPT')` + active price + Stripe price).

## Lanes
- **A** lesson-readiness recheck → enqueues `admin_course_auto_heal_queue.heal_action='lesson_readiness_recheck'`.
- **B** empty published demote → `admin_demote_empty_course(course_id, 'sellable_recovery_batch_1')`.
- **C1** unpublished package on priced curriculum → enqueues `heal_action='publish_course_package'`.
- **C2** no package row at all → audit-only (`sellable_recovery_bridge_no_package`), content factory required.

## Hard guards
- No direct UPDATE on lessons.status / course_packages.status / products.visibility / product_prices.
- No dummy lessons or stub packages.
- Every action audited via `auto_heal_log.action_type LIKE 'sellable_recovery_%'`.

## Surface
- Edge function `sellable-recovery-batch` (admin JWT, dry-run default).
- View `v_sellable_recovery_candidates`.
- Trigger `trg_product_prices_sell_drift` on `product_prices` → never blocks, logs `sell_drift_prevent_priced_orphan` to `auto_heal_log` when activating a price for a public product whose curriculum has zero published packages.
- UI card "Sellable Recovery Batch" inside `/admin/governance/sell-health`.

## Why the drift was possible
Priced + public product can exist without a published course_package on its curriculum, and a published course_package can exist while lessons never reach `ready`. The pre-existing sell-health cockpit detected this retroactively but had no preventive signal at write-time. The trigger now captures the moment a price becomes active so the daily reaper / batch can heal within hours instead of being discovered weeks later.
