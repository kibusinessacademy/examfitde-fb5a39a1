---
name: B2C Pricing SSOT 24,90 € v1
description: Einheitlicher B2C-Preis 24,90 € / 12 Monate für ALLE EXAM_FIRST-Pakete. Keine Per-Beruf-Preise (149€/99€ etc.), kein separates Stripe-Produkt pro Beruf, keine neuen pricing_tiers, keine abweichenden channel_policy_json Defaults.
type: constraint
---

## Pricing SSOT (Stand 2026-05-22)

**Einheitspreis B2C:**
- 24,90 € (BUNDLE_PRICE_CENTS = 2490)
- 12 Monate Zugriff
- Stripe Product: `prod_UJIqaKAx185ofq`
- Stripe Price:   `price_1TKgFDDxqdaWCpJ6cquKeCog`
- Gilt einheitlich für Ausbildung + Studium + Zertifizierung + Weiterbildung
- Quelle: `src/config/pricing.ts` (BUNDLE_*-Konstanten)

**Verboten:**
- Per-Beruf-Preisvorschläge (z. B. 149 € für Bankkaufmann, 99 € für Pflegefachmann)
- Neue Stripe-Produkte/-Preise pro Beruf
- Neue `pricing_tier`-Rows pro Beruf
- Abweichende `channel_policy_json` Defaults
- Drift zwischen Landingpage / Funnel / Checkout

**Für neue Pakete (z. B. Bankkaufmann IHK, Pflegefachmann)** gilt zwingend:
- Re-use der bestehenden aktiven B2C-EXAM_FIRST pricing_tier
- Re-use des bestehenden Stripe-Preises (`price_1TKgFDDxqdaWCpJ6cquKeCog`)
- `course_packages.product_id` → bestehendes Bundle-Product
- Pricing-Hard-Gate (`trg_guard_publish_requires_pricing`) bleibt automatisch grün

**Hintergrund:** Wurde mehrfach vereinheitlicht und als Pricing-Backfill für hunderte Packages verwendet. Abweichungen erzeugen sofort Drift in Pricing-Integrity-Guard, Catalog, Store-Suche, SEO-Pillars und Checkout-Tracking.

**B2B-Tiers** (5/10/25 Seats) bleiben unverändert auf demselben Stripe-Product, mit Mengenrabatten auf perSeatCents-Ebene — kein separates Stripe-Objekt.
