---
name: Checkout Slug Recovery Bridge v1
description: create-product-checkout normalisiert eingehende product_slug und mappt auf canonical products.slug (Umlaute+UUID). Ambiguous = fail-closed mit Audit. Smoke deckt alle 191 sellable Slugs ab.
type: feature
---

## Problem

Frontend-URLs liefern oft den **gefolded slug** (`anlagenmechaniker-in-fuer-sanitaer-heizungs-und-klimatechnik`), während `products.slug` in der DB die **canonical** Variante mit Umlauten + UUID-Suffix trägt (`anlagenmechaniker-in-für-sanitär--heizungs--und-klimatechnik-ef7ba3bf`). `eq("slug", productSlug)` lieferte 404 → Checkout-Funnel zerstört.

## Lösung

`supabase/functions/_shared/slug-normalize.ts` exportiert `normalizeSlug` + `recoverProductSlug`. `create-product-checkout/index.ts` ruft sie nach dem `eq` mit Strategien:

1. `exact` — `products.slug === input`
2. `uuid_suffix_strip` — `db.slug.replace(UUID,'') === input`
3. `normalized` — `normalize(db.slug) === normalize(input)` (unique)
4. `prefix` — unique normalized prefix/suffix candidate
5. `sellable_view` — Fallback über `v_public_sellable_courses`
6. `ambiguous` → 409 mit Audit `checkout_slug_ambiguous`
7. `miss` → 404 mit Audit `checkout_slug_unresolved`

Erfolgreiche Recovery loggt `checkout_slug_recovered` mit `original_slug`, `resolved_product_id`, `resolved_slug`, `strategy`.

## Normalisierung

- lowercase + trim
- ä→ae, ö→oe, ü→ue, ß→ss + NFKD diacritic strip
- Trailing `-[6-8 hex](_archived_…)?` entfernt
- Trailing `-frau / -innen / -in` Tokens entfernt
- `/`, `_` → `-`, doppelte `-` kollabiert, leading/trailing `-` weg

## Tests & Smoke

- `supabase/functions/create-product-checkout/slug-recovery_test.ts` — 8 Deno-Tests (exact, normalized, uuid_strip, ambiguous, miss, empty)
- `scripts/checkout-slug-recovery-smoke.mjs` — 191/191 sellable Kurse aus `v_public_sellable_courses` resolven (177 normalized + 14 uuid_suffix_strip, 0 fail)

## Sicherheit

- Nur `status='active'` Produkte sind Recovery-Kandidaten
- Mehrere Matches → fail-closed (kein Silent-Pick), Audit-Pflicht
- `v_sellable_and_deliverable` Hard-Gate downstream unverändert (kein Bypass)
