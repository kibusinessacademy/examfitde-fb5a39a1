---
name: BerufOS Vertical Packaging v1
description: 11 produktisierte Branchenbetriebssysteme (PraxisOS, SteuerOS, HandwerkOS u.a.) mit Starter/Professional/Enterprise-Tiers, Vorgangs-Limits statt Tokens, separater SKU-Set vom B2C-EXAM_FIRST-Pricing
type: feature
---

## Pivot 2026-05-27: SMB-Vertical-SaaS-Layer

Strategischer Pivot weg von Enterprise-Top-Down hin zu produktisierten Branchenbetriebssystemen für den deutschen Mittelstand. **Positionierung: "Der digitale Branchenmitarbeiter"** — nicht "AI-Plattform".

## Scope

- **11 Verticals** in `src/data/verticals.ts`: praxis, steuer, verwaltung, notar, handwerk, gartenbau, pflege, krankenkasse, kanzlei, makler, foerdermittel
- **3 Tiers** in `src/config/verticalPricing.ts`:
  - Starter — 149 €/mo — 300 Vorgänge/mo (Stripe `price_1Tbj0MDxqdaWCpJ6QNObZfxB`)
  - Professional — 499 €/mo — 3.000 Vorgänge/mo (Stripe `price_1Tbj0ODxqdaWCpJ6Uf5p8JsL`)
  - Enterprise — ab 1.500 € — Sales-Kontakt (kein Selfservice)
- **Routes**: `/branchen` (Hub) + `/branchen/:slug` (Detail)

## Pricing-SSOT-Trennung (kritisch)

Dieser Vertical-Pricing-Layer ist **vollständig separat** vom B2C-EXAM_FIRST-Pricing (24,90 € Bundle, `src/config/pricing.ts`). Zwei eigenständige Stripe-Produkte, eigene Tabellen, eigene Edge-Functions. Keine Drift möglich, da:
- Andere Stripe-Produkte
- Andere DB-Tabellen (`vertical_subscriptions` vs `orders`/`entitlements`)
- Andere Edge-Functions
- Anderer Limit-Begriff ("Vorgänge" statt "Bundle-Access")

## DB

- `vertical_subscriptions` — user_id, vertical_slug, tier, status, stripe_*, current_period_*, monthly_vorgang_limit, vorgaenge_used_current_period
- `vertical_usage_events` — subscription_id, action_type, vorgaenge_consumed, occurred_at
- Helper: `get_active_vertical_subscription(user_id, vertical_slug)`

## Edge Functions

- `create-vertical-checkout` — Stripe Checkout Session (mode=subscription) + pending row in vertical_subscriptions
- `vertical-subscription-status` — Live-Sync von Stripe → DB (status, period_end, limits)
- **Kein Webhook in v1** — Status-Sync per User-Trigger (folgt der Lovable Stripe-Guideline)

## Anti-Drift-Regeln

- **Niemals "unlimited AI"** anbieten
- **Limits in "Vorgängen / Monat"**, nicht in Tokens / Credits — SMB-tauglich
- **Soft-Cap bei Überschreitung** (Hinweis), kein automatischer Bezug
- **Enterprise = Sales-Kontakt**, niemals Selfservice
- **Positionierung**: "Digitaler Branchenmitarbeiter", nicht "AI-Plattform"
- **EU-Trust überall sichtbar**: EU-Hosting, DSGVO, AI-Act-ready, HITL strukturell

## Status

State: **v1 LIVE** (Frontend Shell + Selfservice-Checkout für Starter+Pro).
Pending: Usage-Enforcement-Trigger, Vertical-spezifische Workflows, Sub-Brand-SEO.
