---
name: Post-Purchase Delivery Assurance v1
description: SSOT-Brücke von orders.paid → delivery_confirmed. v_course_delivery_readiness, v_sellable_and_deliverable, v_learner_entitlements_ssot, v_my_active_entitlements, 6 fn_post_purchase_*_check RPCs, trg_orders_paid_delivery_fanout, fn_detect_post_purchase_delivery_sla_breach + Cron 2min, admin_repair_purchase_delivery / admin_repair_learner_entitlement, post-purchase-delivery-worker.
type: feature
---

# Post-Purchase Delivery Assurance v1 (2026-05-16)

## Pipeline
`orders.status='paid'` → BEFORE-Trigger `trg_orders_paid_delivery_fanout` enqueued 6 Jobs (`commerce` lane, idem-key `post_purchase|<job_type>|<order_id>`):
1. `post_purchase_entitlement_create` — Verify+Repair via `grant_learner_course_access`
2. `post_purchase_license_assign` — v1 B2C-noop (B2B-Flow v2)
3. `post_purchase_course_access_verify` — `v_learner_entitlements_ssot.status='active'`
4. `post_purchase_feature_access_verify` — alle 4 has_*-Flags
5. `post_purchase_first_lesson_probe` — `v_course_delivery_readiness.delivery_ready=true`
6. `post_purchase_delivery_audit_snapshot` — aggregiert + setzt `orders.delivery_status` ∈ {pending,in_progress,confirmed,blocked,failed} + `delivery_blocking_reasons text[]`

## SSOT
- **`v_course_delivery_readiness`** (service_role): minichecks≥10 ∧ exam_questions≥50 ∧ tutor_index≥1 → `delivery_ready`. Oral/H5P/Storage v1 soft.
- **`v_sellable_and_deliverable`** (service_role): `is_sellable_and_deliverable = is_published ∧ delivery_ready ∧ product_public ∧ has_stripe_price`. Harte Regel: **sellable = commerce_ready AND delivery_ready**.
- **`v_learner_entitlements_ssot`** (service_role): konsolidiert `learner_course_grants` + `orders` (buyer/learner-Split) + `entitlements` (Feature-Scope).
- **`v_my_active_entitlements`** (authenticated, `security_invoker`): einzige Frontend-API für Zugriffsprüfung. Filtert auf `auth.uid()`.

## SLA-Wächter
`fn_detect_post_purchase_delivery_sla_breach(2)` + Cron `post-purchase-delivery-sla-2min` (`*/2 * * * *`). Bezahlte Orders >2min ohne `delivery_status='confirmed'` werden re-enqueued (idem-Key Minute-Bucket). Audit `action_type=post_purchase_delivery_sla_breach`.

## Worker
Edge `post-purchase-delivery-worker` (Cron `post-purchase-delivery-worker-2min`). Keyed auf `payload.order_id` (nicht `package_id`). RPC-Dispatch Map → `fn_post_purchase_*`. Drain 25/run, jeder Outcome → `auto_heal_log action_type=post_purchase_delivery_worker`.

## Admin-RPCs
- `admin_get_course_delivery_readiness(p_package_id, p_limit)`
- `admin_get_learner_entitlements(p_status_filter, p_limit)`
- `admin_get_paid_but_not_delivered(p_limit)` — Cockpit-Quelle
- `admin_repair_purchase_delivery(p_order_id)` — re-enqueued ganzen Fanout (priority=80)
- `admin_repair_learner_entitlement(p_grant_id)` — Bridge re-trigger via `grant_learner_course_access`

Alle: `has_role(auth.uid(),'admin')` + `SECURITY DEFINER` + Audit.

## Akzeptanzkriterium
Kein `orders.status='paid'` >2 Min ohne `delivery_status='confirmed'` ODER mit gefülltem `delivery_blocking_reasons[]`+Repair-Job.

## v1-Limitierungen (bewusst)
- `fn_post_purchase_license_assign`: signal-only noop (B2C-Path); B2B (license_seats/work_licenses) folgt v2.
- `h5p_assets_ready` / `storage_assets_accessible`: hardcoded true in `v_course_delivery_readiness` bis dedizierter DB-Signal-Pfad existiert.
- `package_license_template_prepare` (Orchestrator v1.1): bleibt **v1-placeholder-noop** — NICHT als „erledigte Lizenzlogik" missverstehen.
- UI-Card `PaidButNotDeliveredCard` noch nicht gebaut (folgt nach 24h Baseline-Beobachtung).
- Checkout-Gate-Verschärfung (`create-product-checkout` auf `is_sellable_and_deliverable`) noch nicht verkabelt — DB-SSOT bereit, Edge-Update folgt.

## Memory-Refs
Erweitert: License-Rollout Loop C Bridge v2, Launch Orders Parity, Post-Publish Orchestrator v1.
