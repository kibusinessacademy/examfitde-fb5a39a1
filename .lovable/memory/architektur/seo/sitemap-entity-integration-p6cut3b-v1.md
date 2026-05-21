---
name: P6 Cut 3b — Dynamic Sitemap Entity Integration v1
description: Pattern-Policies für dynamische SEO-Routen + v_paket_sitemap_entries SSOT + Hard-Gate gegen verbotene Pfade in der Sitemap-Function
type: feature
---

## Was

- `route_crawl_policy` erweitert um Prefix-Index-Policies: `/paket/`, `/blog/`, `/wissen/`, `/pruefungstraining/`, `/berufe/`, `/kurse/`, `/ihk-pruefungen/`, `/produkt/`, `/quiz/` (source=`p6c3b_seed`).
- Alter widersprüchlicher Prefix-Eintrag `noindex /quiz/` entfernt — Auth-Quiz-Routen leben unter `/app/*`, öffentliche Lead-Quizze als exact-Index.
- `fn_resolve_route_crawl_state(path)` STABLE SECURITY DEFINER liefert `index|noindex|redirect|gone` für arbitrary path (exact > prefix > regex; Default index).
- View `v_paket_sitemap_entries` (service_role only) = DISTINCT Beruf-Slugs mit ≥1 published course_package via `course_packages → curricula → berufe`. Baseline 2026-05-21: 177 Slugs (vs 326 aktive Berufe → vorher 149 false-positive /paket-URLs).
- `generate-sitemap` Edge-Function:
  - `/paket/:slug`-Emission jetzt aus `v_paket_sitemap_entries`, nicht aus dem berufe-Loop.
  - Neuer Hard-Gate `SITEMAP_FORBIDDEN_PREFIXES` + `isAllowedSitemapPath()` in `toSitemapXML()` → keine `/products`, `/product/*`, `/category/*`, `/learning/*`, `/dashboard`, `/checkout`, `/search`, `/legal/*` etc. mehr in irgendeiner Sitemap, selbst wenn ein Entity-Resolver versehentlich einen verbotenen Pfad liefert.
- Contract-Test `src/__tests__/sitemap-entity-integration-p6cut3b.test.ts`:
  - Prüft Pattern-Seeds, View+RPC-Existenz, /paket aus SSOT, Forbidden-Prefix-Filter.

## Warum

GSC zeigt 404-Cluster auf `/product/*`, `/learning/*` etc. und gleichzeitig fehlen die published-Pakete + Blogs. Ursache: Sitemap-Erzeugung war an `berufe.ist_aktiv` gekoppelt (326 Slugs) und hatte keinen Hard-Filter gegen die noindex/redirect-Pattern aus Cut 3. Cut 3b koppelt Sitemap an `is_published`+`pricing_ready` (via course_packages) und ergänzt einen zweiten Verteidigungswall in der XML-Serialisierung.

## SSOT-Regel

Niemals einen neuen dynamischen Route-Typ direkt in `generate-sitemap` einbauen, ohne **(a)** eine Prefix-Policy in `route_crawl_policy` UND **(b)** einen Entity-Resolver-View `v_<klasse>_sitemap_entries` (filtert published/ready/quality) anzulegen. Verbotene Pfade landen automatisch im Hard-Gate.

## Nachlauf

- Cut 4/5 (GSC-Reconciliation + Cockpit) konsumieren `fn_resolve_route_crawl_state()` zur Klassifikation jeder gemeldeten URL.
- Vercel-Cutover bleibt separat — bis dahin keine per-Route-Prerender, aber Sitemap-Hygiene ist sauber.
