---
name: IAP.STATUS.LIFECYCLE — Apple ASSN v2 + Google RTDN
description: Receipt + entitlement lifecycle SSOT for mobile IAP (refund/revoke/expire/renewal/restore). Idempotent webhooks, append-only event log, RPC-only entitlement mutations.
type: feature
---

# IAP.STATUS.LIFECYCLE

## SSOT
- `store_receipts.status` = lifecycle SSOT (active|expired|cancelled|refunded|revoked|pending|unknown).
- `entitlements` = single access truth.
- `check_product_access_by_curriculum` = single access read.
- `store_receipt_events` (append-only, admin-read, service-write) = audit log.

## Edge Functions (patched, additive — legacy `mobile_store_*` track preserved)
- `apple-server-notifications` — verifies JWS, normalizes via `normalizeAppleAssnV2Event`, applies via `applyLifecycleEvent`. Idempotent on `notificationUUID`.
- `google-rtdn-notifications` — decodes Pub/Sub, normalizes via `normalizeGoogleRtdnEvent`, applies via `applyLifecycleEvent`. Idempotent on `messageId`.

## Shared modules
- `src/lib/iap/statusLifecycle.ts` — pure normalizer (also mirrored as `supabase/functions/_shared/iap-status-lifecycle.ts`).
- `supabase/functions/_shared/iap-lifecycle-bridge.ts` — applies normalized event to SSOT via RPCs.

## Normalized event vocabulary
purchase_active · renewal_active · restored_active · expired · cancelled · refunded · revoked · billing_retry · grace_period · pending · unknown

## Entitlement action mapping
- purchase_active → activate
- renewal_active / restored_active → restore
- expired → suspend
- cancelled / billing_retry / grace_period / pending / unknown → none
- refunded / revoked → revoke

## RPCs (SECURITY DEFINER, service_role only)
- `revoke_store_entitlement(receipt_id, reason, store_event_id)`
- `suspend_store_entitlement(receipt_id, reason, store_event_id)`
- `restore_store_entitlement(receipt_id, reason, store_event_id, new_expires_at?)`

EXECUTE revoked from anon/authenticated; admin allowed via has_role for diagnostic use.

## Append-only invariants
- Trigger `store_receipt_events_no_update` blocks UPDATE/DELETE.
- Unique `(platform, store_event_id)` ensures idempotency.
- No raw payload persisted — only `masked_payload_hash` (SHA-256 of allow-listed safe keys).

## Player / cache invalidation
After lifecycle apply, the existing client invalidation surface from Phase B unlocks/locks the player on next access read:
product-access · product-access-by-curriculum · product-access-curriculum · entitlements · course-access · learner-course-grants

Player and access hooks are unchanged.

## Tests
- `src/__tests__/iap/iap-status-lifecycle-contract.test.ts` (17): Apple/Google normalization, status/action maps, stale guard, payload masking, hashing.
- `src/__tests__/guards/iap-lifecycle-shadow-paths.test.ts` (5): no client RPC calls, no raw payload persistence, no client lifecycle handlers, no client read on `store_receipt_events`, no shadow status keys.
- Phase B + B.1 guards remain green.

## Known boundaries (next cuts)
- Receipt lookup currently keys on `store_receipts.transaction_id`. For Apple subscriptions where renewals carry a different `transactionId`, the bridge resolves the new tx as `unknown_receipt`. A follow-up should fall back to `original_transaction_id` and to the latest store-side renewal info.
- Legacy `mobile_store_purchase_events` / `mobile_store_receipt_links` writes are still executed alongside the SSOT path; full deprecation tracked separately.
- No manual admin revoke UI shipped — diagnostic only via psql / harness.
