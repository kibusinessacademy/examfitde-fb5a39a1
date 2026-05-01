---
name: Product Persona Routing v1
description: Drei Einstiegspfade pro Produkt (azubi/betrieb/institution) ohne neues Datenmodell — Routing-/Copy-Layer SSOT, persona-CTA führt zur Diagnose
type: feature
---

# Product Persona Routing v1

## Regel
Ein Produkt → drei Einstiegspfade. Persona ist Routing-/Copy-Kontext, **keine neue Produktwahrheit**, **kein neues Datenmodell**.

## Routes
- `/pruefungstraining/:slug` → kanonisches Produkt (ProductPage)
- `/pruefungstraining/:slug/azubi` → ProductPersonaPage (persona='azubi')
- `/pruefungstraining/:slug/betrieb` → ProductPersonaPage (persona='betrieb')
- `/pruefungstraining/:slug/institution` → ProductPersonaPage (persona='institution')

Whitelist-Guard: ungültige Persona → `<Navigate to="/pruefungstraining/:slug" />`.

## SSOT-Files
- `src/lib/landing/productPersonaContext.ts` — Whitelist + Copy-Konfig
- `src/pages/product/ProductPersonaPage.tsx` — wrappt useProductPageSSOT (slug → Produkt/Package)
- `src/components/product/ProductPersonaBand.tsx` — Audience-Chip + Persona-CTA
- `src/components/product/ProductPageTemplate.tsx` — Props `personaContext`, `canonicalOverride`, `onPersonaCtaClick`

## Tracking (SSOT v2 — conversion_events)
Via `useTrackGrowthEvent`. **Pflicht-Felder:** `packageId`, `persona`, `sourcePage`.
- `lead_magnet_view` (event_type, native)
- `landing_view` als `paywall_view` mit `metadata.event_alias='landing_view'` (Bucket bis Event-Type-Erweiterung)
- `cta_click` mit `metadata.cta_type='persona_diagnose'`

## CTA
Persona-CTA führt **immer** zu `/pruefungsreife-check` (Diagnose/Quiz) mit Querystring:
`?package_id=…&persona=…&slug=…&source=product_persona_<persona>`.

## SEO
- Canonical: `https://examfit.de/pruefungstraining/<slug>/<persona>` pro Persona-Variante
- Title-Suffix: `für Azubis` / `für Ausbildungsbetriebe` / `für Bildungsinstitutionen`
- Sitemap: `scripts/seo/load-dynamic-routes.mjs` push 3 zusätzliche `kind=product_persona` URLs pro published Produkt (priority 0.7)

## Smoke
`scripts/persona-routing-smoke.mjs` (statisches Code-Audit) — Whitelist, Tracking-Plumbing, Routes, Sitemap, Canonical, Diagnose-CTA.
