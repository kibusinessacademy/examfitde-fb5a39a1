---
name: Course Resolver Hardening + Scroll Restoration v1
description: Fix "Prüfungstraining nicht gefunden" für alle Homepage-Karten + neuer Seitenlanding ans Bottom. ScrollToTop global + BerufeShowcase liest Catalog-Slugs statt Hardcode + ProductPage Slug-Recovery → /berufe/<echter-slug>.
type: feature
---

# Course Resolver Hardening + Scroll Restoration v1

Drei eng verwandte Mobile-Funnel-Bugs auf einen Schlag geheilt:

## 1. ScrollToTop global

`src/components/ScrollToTop.tsx` — `useLocation()`-Hook setzt `window.scrollTo({top:0, behavior:'instant'})` bei jedem `pathname`-Wechsel. Skip wenn `hash` gesetzt ist (In-Page-Anchors). In `App.tsx` direkt unter `AppChrome` gemountet, innerhalb `<BrowserRouter>`. Vorher: react-router behielt vorigen Scroll-Stand → Nutzer landete auf neuer Seite "ganz unten". Klassischer SPA-Bug.

## 2. BerufeShowcase Slug-Drift gefixt

`src/components/landing/v2/BerufeShowcase.tsx` listete **8 Karten mit hardcodierten Slugs**, die so nicht im Catalog existierten:

| Hardcode | Catalog | Resolver |
|---|---|---|
| `industriekaufmann` | `industriekaufmann-frau` | ❌ 404 |
| `bilanzbuchhalter` | `bilanzbuchhalter-ihk` | ❌ 404 |
| `aevo` | `aevo-ausbildereignungspruefung` | ❌ 404 |
| `kaufmann-im-einzelhandel` | `kaufmann-frau-im-einzelhandel` | ❌ 404 |
| `fachinformatiker-anwendungsentwicklung` | `fachinformatiker-in-anwendungsentwicklung` | ❌ 404 |

→ jede der 8 Top-Karten zeigte „Prüfungstraining nicht gefunden". Komponente liest jetzt SSOT aus `useHomepageCatalog()`, kuratiert über `PROMO`-RegEx-Liste (Reihenfolge + Trending-Flag) und linkt via `getBerufUrl(slug)` → `/berufe/:slug` (`BerufDetailPage` arbeitet auf demselben Catalog-View). Fallback füllt mit Top-Popularity bis 8 Karten. Kategorie-Filterchips funktional via `AREA_MATCH`-RegEx, kein No-Op-State mehr.

## 3. ProductPage Slug-Recovery

`src/lib/slug-recovery.ts` — pure helper:

- `normalizeSlug()` — fold Umlaute (ä→ae, …), strippt UUID-Suffix `-xxxxxxxx[__archived_…]`, droppt gendered Tokens `-frau|-in|-innen` mid- und end-of-string, kollabiert Trenner.
- `findCatalogSlugCandidate(incoming, catalogSlugs)` — 3 Stufen: exact (→null, Caller lädt eh), normalisiert exact (eindeutig), Prefix/Suffix (eindeutig). Mehrdeutige Treffer → null (nie raten).

In `ProductPage.tsx`: bei `error || !product` zieht ein zweiter Query `useHomepageCatalog`, bei eindeutigem Recovery-Slug `navigate(getBerufUrl(recovered), {replace:true})` + emit `course_resolver_recovered`-Event mit referrer + originalem slug. Bei No-Match: Soft-Fail-UI mit 3 verwandten Berufen + 2 CTA-Fallbacks („Alle Berufe", „Startseite") + `course_resolver_failed`-Event.

## Tests

- `src/lib/__tests__/slug-recovery.test.ts` — 12 Cases: `normalizeSlug` (Umlaut, UUID-Suffix, gendered tokens), `findCatalogSlugCandidate` (exact-skip, gender-recovery, prefix/suffix recovery, ambiguity-null, empty input/catalog).
- E2E im Browser bestätigt: `/pruefungstraining/industriekaufmann` → 302 → `/berufe/industriekaufmann-frau` (Page rendert, Scroll oben).

## Bewusst NICHT geändert

- `v_product_page_published_ssot` Schema — Slug-Drift dort (UUID-Suffixe, archived-Marker) ist deeper SSOT-Issue, separater Cut.
- Resolver-Logik im `useProductPageSSOT`-Hook — Recovery liegt im UI-Layer um Hook-Verträge nicht zu brechen.
- Keine Auto-Redirect von /pruefungstraining/* auf Route-Ebene — nur soft Recovery in der Page (Tracking-Sichtbar).
- Keine Slug-Mutation im Catalog selbst.
