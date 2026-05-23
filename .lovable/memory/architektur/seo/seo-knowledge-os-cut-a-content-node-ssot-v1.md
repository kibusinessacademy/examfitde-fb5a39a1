---
name: SEO Knowledge OS Cut A — Content-Node-SSOT View
description: Read-only Bridge-View v_seo_content_node_ssot vereint 7 SEO-Content-Quellen zu einer Knoten-SSOT; Admin-RPCs admin_get_seo_content_node_ssot(_summary); keine Datenmigration, keine neue Tabelle. Foundation für Cut B (Refresh-Queue) und Cut C (Conversion-Routing).
type: feature
---

## Bridge-Quellen → Node-Typen

| node_type            | source_table                | is_indexable Logik             | canonical_url Pattern              |
|----------------------|-----------------------------|--------------------------------|------------------------------------|
| seo_document         | seo_documents               | status='published'             | examfit.de/{slug}                  |
| blog_article         | blog_articles               | status='published'             | examfit.de/blog/{slug}             |
| certification_page   | certification_seo_pages     | is_published                   | examfit.de/{slug}                  |
| seo_content_page     | seo_content_pages           | status='published'             | examfit.de/{slug}                  |
| glossary_page        | profession_glossaries       | false (kein Slug)              | NULL                               |
| persona_overlay      | product_persona_overlays    | false (Overlay, keine Page)    | NULL                               |
| course_package       | course_packages             | is_published                   | NULL (Routing über Cut C)          |

## Identity & Security

- `node_id = '<node_type>:<source_id>'` — eindeutig (verifiziert: 2650/2650)
- View read-only, REVOKE FROM PUBLIC/anon/authenticated, GRANT SELECT TO service_role
- Client-Zugriff ausschließlich via SECURITY DEFINER RPCs mit `has_role(auth.uid(),'admin')` Gate

## Baseline 2026-05-23

- 2650 Nodes total, alle 7 Typen vertreten
- 1335 indexable, 0 indexable ohne Slug
- Verteilung: 700 seo_content_page · 521 seo_document · 442 course_package · 307 blog_article · 267 glossary_page · 215 certification_page · 198 persona_overlay

## Constraints

- KEINE Bestandsmigration. KEINE Replacement-Tabelle.
- KEINE Conversion-Tracking-Tabelle (Cut C arbeitet auf separater seo_conversion_route).
- KEINE Producer-Anpassungen — Quelltabellen bleiben unangetastet.
- canonical_url ausschließlich auf examfit.de (Authority-Host SSOT).

## Nächste Cuts

- **Cut B**: seo_refresh_queue Producer aktivieren (referenziert node_id).
- **Cut C**: deklarativer Conversion-Routing-Layer (seo_conversion_route mit FK auf node_id-Strings).
- **Cut D**: Region/Level-Intent-Achsen.
