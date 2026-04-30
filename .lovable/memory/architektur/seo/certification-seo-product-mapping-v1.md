---
name: SEO-Page → Product Mapping (ID-first SSOT)
description: Mapping certification_seo_pages → kanonische Kategorie-URL + Kursprodukt via ID-Kette, mit Slug-Fallbacks und Redirect-Route.
type: feature
---

# SEO ↔ Product Mapping SSOT

## URL-Konvention
- **Kanonisch**: `/<category>/<seo-slug>` (z.B. `/fachwirt/fachwirt-einkauf-ihk-pruefung`).
  Kategorie aus `certification_catalog.catalog_type`:
  `Fortbildung_IHK→fachwirt`, `Meister→meister`, `Branchenzertifikat→sachkunde`,
  Slug-Präfix `(itil|prince2|psm|pspo|scrum)→projektmanagement`, sonst `ausbildung`.
- **Redirect-only**: `/pruefung/:slug` → `<Navigate replace>` auf kanonische URL.
  Nicht in Sitemap, nicht in internen Links.

## Mapping-Quelle (SSOT)
View `v_certification_seo_with_product` mit `mapping_source`-Audit-Spalte.

**Match-Priorität (ID-first)**:
1. `id_chain` — `seo.certification_catalog_id → catalog.linked_certification_id → course_packages.certification_id` (sobald `linked_certification_id` befüllt wird, Top-Source)
2. `catalog_slug` — `catalog.slug → certifications.slug → course_packages.certification_id`
3. `slug_base` — Regex `<base>-pruefung` ↔ `<base>-<uuid8>` (Notfall)
4. `unmatched` — kein Produkt → CTA fällt auf `/shop?ref=<slug>`

Helper-RPC: `get_certification_seo_with_product(p_slug text)` (SECURITY DEFINER, anon+authenticated).

## Wo verwendet
- Frontend: `useCertificationSeoMapping` (Hook), `CertificationSEOPage` (canonical + Buy-CTA),
  `PruefungSlugRedirect` (Route `/pruefung/:slug`).
- Cockpit: `ContentPageEditor` zeigt + öffnet die kanonische URL (kein `/pruefung/...` mehr).
- Sitemap: `generate-sitemap?action=berufe` nimmt nur `canonical_url_path` aus der View.

## Aktuelle Match-Quote (April 2026)
3/42 (`catalog_slug`-Treffer: betriebswirt-ihk, bilanzbuchhalter-ihk, prince2-foundation).
39/42 unmatched = Daten-Gap (course_packages für diese Berufe fehlen). Mapping wird automatisch
über alle 4 Quellen aufholen, sobald entweder `linked_certification_id` befüllt oder neue Pakete
publiziert werden.
