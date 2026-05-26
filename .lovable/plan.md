## Cut: BerufOS Legal + Premium Produktseiten + Self-Updating Registry

Du hast den maximalen Scope gewählt: Impressum + AGB + 4 Produktseiten (alle live) + Dynamic Registry + JSON-LD + Trust + persona-adaptive CTAs. Ich bauen das in **zwei Migrations-armen Wellen**, weil "selbstständig aktualisierend" sonst zur Halbgeburt wird.

### Welle 1 — Legal + Statische Premium-Produktseiten (heute live, sofort verkaufsfähig)

**Routen**
- `/impressum` — gelieferter Text wortgetreu, DSGVO/§5 TMG/§18 MStV/EU-AI-Act-Transparenz-Sektion
- `/agb` — 12 Klauseln wortgetreu, mit Stand-Datum
- `/produkte` — Hub mit 4 Kacheln (BerufOS-Plattform, VertragscheckerOS, IdeenlosOS, ComplianceOS)
- `/produkte/berufos` · `/produkte/vertragscheckeros` · `/produkte/ideenlosos` · `/produkte/complianceos`

**Komponenten (SSOT)**
- `src/lib/legal/legal-copy.ts` — Impressum + AGB als typed structured data (für Audit & späteres CMS)
- `src/lib/products/product-registry.ts` — 4 Produkte: hero, subline, usps[], cta, faqs[], trust[], persona-cta-map
- `src/components/products/ProductLandingShell.tsx` — Premium-Shell mit Hero / USP-Grid / Trust-Pillars / FAQ-Accordion / persona-adaptive CTA / Final-CTA. Token-konform (BerufOS-Brand via `.berufos` scope, Memory: berufos-masterbrand-v1).
- `src/components/products/PersonaCTA.tsx` — liest `useOsBeruf()` + `?persona=` Query, schaltet CTA-Label/Target.
- `src/pages/legal/ImpressumPage.tsx` + `AgbPage.tsx`
- `src/pages/products/ProduktHub.tsx` + dynamische Route `/produkte/:slug` → `ProductLandingPage.tsx`

**SEO**
- `react-helmet-async` per Route: Title, Description, Canonical (`https://berufos.com/...`), og:*
- JSON-LD pro Produktseite: `Product` + `FAQPage` + `BreadcrumbList`
- Sitewide bleibt `Organization` in `index.html`
- `scripts/generate-sitemap.ts` (oder bestehender Generator) um neue Routen erweitert
- Footer-Link auf `/impressum` + `/agb` in `BerufOSFooter`

**Trust-Bereich** (statische TrustPillars-Komponente, reuse-fähig)
- DSGVO-konform · EU AI Act ready · Made in Germany · Human-in-the-loop · Auditierbar · Rollenbasierte Sicherheit · Kein Blackbox-System

### Welle 2 — Self-Updating Layer (optional, nach Freigabe Welle 1)

Damit Produktseiten sich "selbstständig aktualisieren" (FAQs, USPs, Changelog), brauchen wir:
- Tabelle `product_pages` (slug, hero, subline, status, updated_at)
- Tabelle `product_features` (product_slug, title, description, position)
- Tabelle `product_faqs` (product_slug, question, answer, position)
- Tabelle `product_changelog` (product_slug, version, body, released_at)
- Admin-Route `/admin/products/registry` zum Editieren (has_role gated)
- `ProductLandingPage` liest dann aus DB statt aus TS-Registry, fällt auf TS-Default zurück wenn keine DB-Row.

**Architectural Continuity Note**: 4 neue Tabellen lösen den `/admin/governance/architecture`-Pflichtcheck aus (Memory-Core-Rule). Ich registriere sie dort, bevor ich die Migration schreibe.

### Bewusst NICHT in diesem Cut
- Stripe-Checkout an Produktseiten (existiert bereits via `startProductCheckout`-SSOT — wir verlinken nur)
- Programmatic-SEO-Seiten (das ist eigener Cut, Memory `seo-content-priority-queue` ist SSOT)
- og:image Generation (kann später per imagegen nachgereicht werden)
- Datenschutzerklärung-Volltext (du hast nur Kurzfassung geliefert — ich nehme die wörtlich + Hinweis-Link)

### Reihenfolge
1. Welle 1 komplett bauen → live testen
2. Du sagst "Welle 2 starten" → Migrations + Admin-UI
3. Memory + Sitemap-Update nach jedem Schritt (User-Memory-Core-Rule)

Soll ich mit **Welle 1** loslegen?
