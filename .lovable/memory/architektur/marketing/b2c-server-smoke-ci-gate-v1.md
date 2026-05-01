---
name: B2C Server-Smoke CI-Gate (Live-Mode-sicher)
description: Stripe-Karten-CI deaktiviert wegen Live-Mode-Key. CI-Gate läuft via b2c-ssot-smoke Edge Function (synthetisch, 8 Artefakte + Idempotenz).
type: feature
---

# B2C SSOT Server-Smoke als CI-Gate (2026-05-01)

## Warum
`STRIPE_SECRET_KEY` im Edge-Function-Secret-Store ist `sk_live_...`. Der Karten-Smoke (Pfad 1+2) würde echten Zahlungsverkehr auslösen ODER wegen Live-Mode 4242 ablehnen. Daher:

- `.github/workflows/stripe-smoke-b2c.yml` → **deaktiviert** (nur noch manueller `workflow_dispatch` mit `i_understand_live_mode=LIVE_MODE_OK` Gate). Specs bleiben für späteren Re-Enable.
- **Neu**: `.github/workflows/b2c-ssot-server-smoke.yml` + `scripts/b2c-ssot-server-smoke.mjs` → ruft `b2c-ssot-smoke` Edge Function. Cron alle 6h + bei Push auf `stripe-webhook`/`create-product-checkout`/`b2c-ssot-smoke`.

## Server-Pfad verifiziert
`create-product-checkout` (Live-Mode) liefert vollständig: `order_id, package_id, persona, price_id, product_id, stripe_price_id`. `orders.pending` + `conversion_events.checkout_started` mit allen 6 Pflichtfeldern (Sprint-1-SSOT) vor Redirect persistiert.

## Bug-Fix in b2c-ssot-smoke
Alte Version filterte `learner_course_grants` und `entitlements` per `created_at >= now-2min`. Da `grant_learner_course_access` UPSERT macht, bleibt `created_at` bei wiederholten Smoke-Runs unverändert → falsche Failures. Fix: Match per `order_id`/`source_ref` + `valid_until > now()` + alle 4 has_*-Flags=true. Ergebnis: `ok:true, failures=[]`, alle Artefakte ≥1.

## Re-Enable Karten-Smoke (Voraussetzungen)
Eine von:
- (a) Separate Secrets `STRIPE_SECRET_KEY_TEST` + `STRIPE_WEBHOOK_SECRET_TEST` + ENV-gesteuertes Switching in den Edge Functions.
- (b) Stripe-Account temporär in Test-Mode (nur für Run, dann zurück).

## Reststand
Live-Pending-Order `982d1efd-c404-436c-8e28-0297fe5d4668` (~24,90€) bleibt als `pending` in der Live-DB stehen — harmlos (kein Zahlungseingang), kann manuell im Stripe-Dashboard expired/cancelled werden.
