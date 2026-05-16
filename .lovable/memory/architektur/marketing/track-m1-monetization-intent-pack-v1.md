---
name: Track M1 Monetization Intent Pack
description: 6 neue Conversion-Intents (Paywall/Checkout-Recovery, Readiness-Upsell, Bundle-Upsell, B2B Seat-Expiry), Producer-Cron + Revenue-Attribution-View + Admin-Card.
type: feature
---

# Track M1 — Monetization Intent Pack (2026-05-16)

## Scope
Erweitert Notification-Engine um monetarisierungs-relevante Intents. Nutzt vorhandene Track 2.2/2.3/2.5-Infrastruktur (Registry, Effectiveness, Enforcement) — keine neue Engine.

## Neue Intents (notification_intent_registry)
- `paywall_abandoned_24h` — paywall_view ohne checkout_complete in 24–72h
- `checkout_abandoned_1h` — checkout_start ohne checkout_complete in 1–24h
- `checkout_abandoned_24h` — checkout_start ohne checkout_complete in 24–72h
- `readiness_red_upsell` (sensitive) — readiness_score<40, kein Entitlement
- `bundle_upsell_after_first_pass` — Post-Pass Cross-Sell
- `org_seat_expiring_30d` — B2B-Renewal-Hebel

## Producer
- `fn_emit_monetization_intents(dry_run)` — service_role, idempotent via dedupe_key=`<intent>:<date>`.
- Filter: `entitlements`-Exists-Check schützt vor "Notification an Bezahler".
- Cron `monetization-intent-producer-hourly` (`17 * * * *`).

## notification_jobs.kind erweitert
`paywall_abandoned`, `checkout_abandoned`, `readiness_red_upsell`, `bundle_upsell`, `org_seat_expiring`.

## Revenue-Attribution SSOT
- View `v_notification_revenue_attribution` (service_role only) joins `notification_dispatch_decisions × notification_jobs × orders` mit 7-Tage-Attribution-Fenster.
- RPC `admin_get_notification_revenue_attribution(window)` mit `has_role(admin)`-Gate, Windows: `24h|7d|30d`.
- UI: `NotificationRevenueAttributionCard` (HealCockpitPage, Notification-Sektion).

## Smoke
`admin_smoke_monetization_intents()` prüft 6/6 Intents + Producer-Dry-Run-Pfad.

## Bewusste Auslassungen (für spätere Loops)
- Stripe-Webhook → automatische `checkout_abandoned`-Annullierung bei späterer Zahlung: aktuell via 7-Tage-Order-Join im View abgefangen (kein Reverse-Cancel auf bereits enqueued/sent Jobs).
- B2B Seat-Expiry Producer: Intent existiert, Cron-Producer folgt in Track M2 (Renewal Pipeline) mit `org_licenses`-Scan.
- Bundle-Upsell: `curriculum_upsell_paths`-Tabelle Track M2.

## Files
- Migration: `supabase/migrations/<ts>_*.sql`
- UI: `src/components/admin/heal/cards/NotificationRevenueAttributionCard.tsx`
- Cron: `monetization-intent-producer-hourly`
