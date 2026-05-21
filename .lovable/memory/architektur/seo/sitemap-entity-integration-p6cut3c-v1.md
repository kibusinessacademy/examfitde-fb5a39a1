---
name: P6 Cut 3c — Blog + Knowledge Dynamic Sitemap Parity v1
description: SSOT-Views v_blog_/v_wissen_/v_pruefungstraining_sitemap_entries; Bugfix noindex-Spalte auf seo_documents/blog_articles; Per-Klasse Counts im Sitemap-Log; Parity-Contract-Test
type: feature
---

## Was

- Drei neue SSOT-Views (service_role only, REVOKE from anon/authenticated):
  - `v_blog_sitemap_entries(slug, lastmod, source)` — published `blog_articles` ∪ `blog_posts` (mit noindex-Respect), dedup via DISTINCT ON (slug). Baseline 2026-05-21: **237** distinct Blog-Slugs.
  - `v_wissen_sitemap_entries(path, lastmod, source)` — routed Pillar/Satellite-Entities (`beruf|kompetenz|pruefung`) aus dem aktuell **published** Semantic-Graph-Snapshot UNION `seo_documents` (Nicht-Landing). Baseline: **143** Wissen-Pfade (93 beruf + 50 kompetenz, 0 pruefung, 0 seo_docs non-landing).
  - `v_pruefungstraining_sitemap_entries(slug, lastmod, source)` — published `seo_documents` doc_type=landing UNION `certification_catalog`. Baseline: **353** Slugs.
- `generate-sitemap` Edge-Function liest jetzt für `blog`, `landing`, `content` ausschließlich aus diesen Views. Berufe-Branch bleibt + behält `v_paket_sitemap_entries`.
- **Bugfix**: `seo_documents` und `blog_articles` haben **keine** `noindex`-Spalte. Vorherige Selects mit `.select("..., noindex")` haben PostgREST mit 42703 abgewiesen → Branches gaben **0 URLs** zurück. Selects auf nicht-existente Spalten entfernt. `noindex` wird jetzt ausschließlich für `blog_posts` und `content_pages` ausgewertet (Spalten existieren dort).
- Per-Klasse Count-Logs (`[generate-sitemap] class=<x> count=<n>`) in jedem Branch — Vorbereitung für Cut 4 (GSC-Reconciliation kann Counts gegen erwartete Klassen-Volumina prüfen).
- Audit-Contract `sitemap_class_counts` registriert (required_keys: static, berufe, paket, blog, wissen, pruefungstraining, content, total).
- Contract-Test `src/__tests__/sitemap-entity-integration-p6cut3c.test.ts` prüft: View-Existenz, service_role-Grants, branch-spezifische SSOT-Nutzung, kein `noindex` mehr auf `seo_documents`, Count-Logs, Forbidden-Prefix-Hard-Gate aus Cut 3b.

## Warum

Cut 3b hat /paket sauber, ließ aber die anderen dynamischen Klassen unangerührt. Ergebnis-Audit zeigte zwei Drift-Ursachen: (a) PostgREST-400 wegen nicht-existenter Spalten → Sitemaps `blog`, `landing`, `content` blieben de facto leer (außer `seo_content_pages`/`content_pages`); (b) keine SSOT-View → Source-of-Truth verstreut, schwer gegen Cut 4 zu validieren. Cut 3c löst beides.

## Delta-Erklärung (für Cut 3b)

177 /paket-Slugs vs „über 200 published Pakete":
- 190 `course_packages.is_published=true` total
- –12 Pakete mit `curriculum_id` aber `curricula.beruf_id IS NULL`
- –1 Paket auf `berufe.ist_aktiv=false`
- = 177 distinct `bezeichnung_kurz` Slugs (mehrere Pakete pro Beruf teilen sich denselben /paket-Slug)

Die 13 fehlenden Pakete brauchen entweder Beruf-Reattach oder einen alternativen URL-Schema-Resolver (`/paket/<package_slug>`). Wird in einem späteren Cut adressiert, sobald `course_packages.slug` SSOT-ready ist.

## Nachlauf

- Cut 4 (GSC-Reconciliation) konsumiert die Count-Logs + `fn_resolve_route_crawl_state()` für Drift-Detection (z.B. published_blog_count = 237 vs sitemap_blog_count im Log).
- Vor Vercel-Cutover bleibt alles auf Lovable-Hosting (SPA-Fallback), aber die Sitemap selbst ist jetzt vollständig.
