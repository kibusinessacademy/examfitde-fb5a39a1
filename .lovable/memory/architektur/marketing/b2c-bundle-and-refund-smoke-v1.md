---
name: B2C Bundle + Refund Smoke v1
description: Pfad 3 (Bundle, mehrere products in 1 Order) + Refund-Smoke (DB-Sim) als Server-Smoke-Modi. Deckte 2 latente Bugs auf.
type: feature
---

# B2C Bundle + Refund Smoke (2026-05-01)

`b2c-ssot-smoke` Edge Function unterstützt 3 Modi:
- **single**: 1 product → 7 Artefakte + Replay-Idempotenz
- **bundle**: N products in 1 Order → N grants, N entitlements (1 pro distinct curriculum), 1 invoice/payment, N invoice_items
- **refund**: paid order → `fn_revoke_grant_on_refund(pi, refund_id, reason)` → grants→refunded, entitlements valid_until≤now, admin_actions Audit, 2. Run idempotent (revoked_grants=0)

CI-Gate `scripts/b2c-ssot-server-smoke.mjs` läuft alle 3 Modi via `SMOKE_MODES=single,bundle,refund` (Default).

## Latente Bugs gefixt
1. **Bundle-Bug**: `process_order_paid_fulfillment` hatte `LIMIT 1` beim Grant — nur 1. order_item bekam Freischaltung. Fix: `FOR ... LOOP` über DISTINCT (curriculum_id, product_id). `grant_learner_course_access` ist intern idempotent.
2. **Refund-Constraint**: `fn_revoke_grant_on_refund` setzt `status='refunded'`, aber `learner_course_grants_status_check` erlaubte nur pending/active/paused/completed/revoked. Fix: `refunded` zu Constraint hinzugefügt.

Audit-Tag in auto_heal_log: `order_paid_fulfillment_v5_bundle`.
