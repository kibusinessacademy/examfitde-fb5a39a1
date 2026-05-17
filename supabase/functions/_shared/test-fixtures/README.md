# Test-Fixture-Contract (B)

Single Source of Truth (SSOT) for **all writes performed by smoke and E2E edge functions**.

## Rule

> **No smoke/E2E edge function may write rows directly to commerce or entitlement tables.**
> Every fixture must go through a factory in this directory.

Targets currently in scope (writes must be routed through factories):

- `orders`, `order_items`
- `profiles`
- `learner_course_grants`, `entitlements`
- `store_products`, `products` (test-rows only — production rows come from migrations)

## Why

1. **Schema-Drift hard-fail.** Each factory asserts the live schema via
   `information_schema.columns` before touching a table. Drift → hard-fail +
   audit (`test_fixture_schema_drift`). No more silent column-mismatches.
2. **Audit Pflicht.** Every fixture insert emits `test_fixture_created` via
   `fn_emit_audit` with `{fixture_kind, target_table, correlation_id}`.
   Every cleanup emits `test_fixture_cleanup` with `removed_count`.
3. **Production-Path-Reuse.** Where possible, factories call the production
   path (`trg_orders_paid_grant`, `grant_learner_course_access`,
   `process_order_paid_fulfillment`) instead of hand-rolling inserts. That
   way the smoke covers the same code path the customer would hit.
4. **Deterministic Cleanup.** Every fixture is tagged with `correlation_id`
   so `_smoke_cleanup_by_correlation(correlationId)` removes exactly that
   smoke-run's rows and nothing else.

## CI Guard

`scripts/guards/test-fixture-contract-guard.mjs` scans every file under
`supabase/functions/**/*smoke*` and `supabase/functions/**/*e2e*` and
**fails the build** if it finds raw `.from('<scoped-table>').insert(` or
`INSERT INTO <scoped-table>` outside `_shared/test-fixtures/`.

Baseline waivers (legacy, must be migrated as part of Path C):

- `supabase/functions/b2c-ssot-smoke/index.ts`
- `supabase/functions/test-orchestrator/tests/wave3-entitlement-fulfillment.test.ts`

New violations are blocked from the cutoff date forward.

## API

```ts
import { newCorrelationId, assertTableSchema, createSmokeUser,
         createSmokeOrder, cleanupSmokeByCorrelation }
  from "../_shared/test-fixtures/index.ts";

const correlationId = newCorrelationId();
try {
  const user  = await createSmokeUser(sb, { correlationId });
  const order = await createSmokeOrder(sb, {
    userId: user.id, packageId, productId, correlationId,
  });
  // ... assertions on production-path side effects ...
} finally {
  await cleanupSmokeByCorrelation(sb, { correlationId });
}
```
