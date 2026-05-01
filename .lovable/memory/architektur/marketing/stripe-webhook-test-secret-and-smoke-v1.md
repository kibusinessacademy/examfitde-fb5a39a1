---
name: Stripe-Webhook Test-Secret + Smoke v1
description: Dual-Secret-Validierung in stripe-webhook (live + STRIPE_WEBHOOK_TEST_SECRET) plus stripe-webhook-smoke Edge Function für signed-event handler-tests mit DB-Verify.
type: feature
---

# Stripe-Webhook Smoke (2026-05-01)

## Webhook-Änderungen
- `constructEventAsync` (Deno-kompatibel) statt sync `constructEvent`.
- Optionaler **STRIPE_WEBHOOK_TEST_SECRET**: Wird verifiziert, falls Live-Secret fehlschlägt. Nur in Smoke/Staging-Env setzen.
- Strukturierte JSON-Logs: `{tag, step, ts, event_type, event_id, livemode, signature_source, ...}` — filterbar nach Branch / Event-Typ / DB-Effekt.

## Neue Edge Function `stripe-webhook-smoke`
- Service-role-only.
- Signiert checkout.session.completed + charge.refunded mit `STRIPE_WEBHOOK_TEST_SECRET` (HMAC-SHA256, Stripe v1-Schema).
- POSTet an deployed `stripe-webhook`, verifiziert DB-Seiteneffekte:
  - **checkout**: orders.status=paid, learner_course_grants vorhanden, entitlements bridge.
  - **refund**: grant.status=refunded, entitlement.valid_until≤now, admin_actions audit (soft).
- Cleanup nach Run (best-effort).

## CI
`b2c-ssot-server-smoke.yml` ruft jetzt zuerst `scripts/stripe-webhook-smoke.mjs` (handler-fast-fail), dann `b2c-ssot-server-smoke.mjs` (full DB pipeline). Triggered auch bei Änderungen in `stripe-webhook-smoke/**` und `scripts/stripe-webhook-smoke.mjs`.

## Setup-TODO
`STRIPE_WEBHOOK_TEST_SECRET` als Edge-Secret in Lovable Cloud setzen (z.B. `whsec_test_<random>`). Niemals derselbe Wert wie Prod-Webhook-Secret.
