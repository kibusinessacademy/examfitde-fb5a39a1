---
name: Checkout-Tracking SSOT (Sprint 1)
description: startProductCheckout migriert auf server-side checkout_started in conversion_events. Edge create-product-checkout resolved package_id und schreibt Strict-Event vor Stripe-Redirect. Kein tracking_events-Pfad mehr.
type: feature
---

# Checkout-Tracking SSOT (Sprint 1 — checkout_started Migration)

## Problem
Vorher: `startProductCheckout` → `TrackingEvents.checkoutStarted` → `tracking_events` (anderes Table). 
Nach Stripe-Redirect war das Browser-Tracking-Window weg → 80%+ silent loss.
`conversion_events` hatte nur `checkout_complete` (nicht `_started`) → blinder Funnel.

## Lösung: Server-Side Tracking
- **Client `startProductCheckout(slug, ctx?)`**: gibt nur Tracking-Kontext (`anonymous_id`, `session_id`, `source`, `persona_type`, `source_page`) an Edge-Function. Kein `tracking_events`-Insert mehr im Browser.
- **Edge `create-product-checkout`**: 
  - resolved `package_id` + `persona` aus `product → curriculum_id → published course_packages` (gleiches Pattern wie `emitCheckoutCompleteEvent` im stripe-webhook).
  - inserted `checkout_started` in `conversion_events` mit Pflicht-`metadata.package_id` **vor** Order-/Stripe-Session-Creation-Return.
  - returnt `package_id`, `persona`, `product_id`, `price_id`, `stripe_price_id` an Client (für SPA-Telemetry).
  - hängt `package_id` + `persona` auch in Stripe `session.metadata` (Webhook-Konsistenz).

## Pflichtfelder `metadata` von `checkout_started`
- `package_id` (UUID, SSOT)
- `persona` / `persona_type`
- `source` (z.B. `persona_landing`, `dynamic_product_landing`)
- `source_page` (canonical pathname)
- `product_id`, `product_slug`
- `price_id`, `stripe_price_id`, `amount_cents`, `currency`
- `order_id`, `flow`

## Aufrufer (Sprint 1)
- `src/pages/landing/DynamicProductLandingPage.tsx` → `source: "dynamic_product_landing"`
- `src/pages/landing/PersonaLandingPage.tsx` → `source: "persona_landing"`, `persona_type` aus config

## Smoke (`scripts/checkout-tracking-smoke.mjs`)
- prüft Pflichtfelder + zeitliche Reihenfolge `checkout_started < checkout_complete` pro `order_id`
- baseline 2026-05-01: 0 checkout_started in 7 Tagen → erster echter Klick erforderlich für vollen Beweis

## Invarianten
- Tracking überlebt Stripe-Redirect (server-side persistiert vor Response).
- Kein `tracking_events`-Insert mehr für `checkout_started`.
- `package_id` in Stripe-Metadaten + DB-Event = identische SSOT-Quelle (curriculum_id → published).
- Tracking-Failures dürfen Checkout NIE blockieren (try/catch um Insert).
