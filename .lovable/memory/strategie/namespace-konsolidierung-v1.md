---
name: Namespace Konsolidierung v1 (Cut 4 Bigbang)
description: SSOT-Namespaces berufos (Brand) + berufs-ki (Produkt). berufski ist deprecated und entfernt.
type: constraint
---

# Namespace Konsolidierung v1 — Cut 4 Bigbang (2026-05-26)

## SSOT

| Namespace | Rolle | Beispiele |
|---|---|---|
| `berufos` | Plattform / Brand / Betriebssystem | `/berufos`, `berufos.com`, `BerufOS` |
| `berufs-ki` | Produktmodul / Workbench / KI-Berufsanwendungen | `/berufs-ki`, `/berufs-ki/workbench`, Komponente `BerufsKIWorkbenchPage` |
| `berufski` | **DEPRECATED — entfernt** | — keine Routen, keine Files, keine Edge-Functions, keine Domain |

## Bigbang-Status

Stand 2026-05-26 (Cut 4): `rg -i berufski` in aktivem Code → **0 Treffer**.
- Keine `/berufski/*`-Routen.
- Kein `berufski-checkout` Edge-Function-Alias.
- `berufski.de` war nie registriert.
- Erlaubte Restvorkommen: `supabase/migrations/**` (historisch), `.lovable/memory/**` (Doku).

## Checkout-SSOT

Alle B2C-Checkouts laufen über **`create-product-checkout`** Edge Function.
Keine parallele Checkout-Logik unter Legacy-Namespaces erlaubt.

## Guard

`scripts/guards/namespace-drift-guard.mjs` (npm: `guard:namespace-drift`):
- Blockiert neue Treffer für `/berufski`, `berufski.de`, `berufski-checkout`, `berufski`.
- Ausnahmen: Migrationen + Memory.

## Begründung Bigbang (statt Bridge)

- Keine echten Besucher auf Legacy-Pfaden → kein 301-Bedarf.
- Bridge-Kosten (Code + Mental Load) > Migrations-Risiko.
- Forward-only Architektur passt zu Market-Activation-Pivot.

## Nicht im Scope

- `berufs-ki` bleibt bestehen (klare Trennung Brand vs. Produkt).
- Stripe-Product-IDs unverändert (Pricing SSOT 24,90 €).
- Sub-Brand-Domains `examfit.de`/`examfitwork.de` bleiben 301-Shells auf `berufos.com` (P8).
