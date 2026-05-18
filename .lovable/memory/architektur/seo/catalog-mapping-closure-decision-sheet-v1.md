---
name: SEO Catalog Mapping Closure — Decision Sheet v1
description: 17 NO_CATALOG_MAPPING packages, per-package deterministic mapping proposal (catalog_type/chamber/track/recognition). Read-only, no mutation. Anti-Drift: Polizei excluded.
type: feature
---

# SEO Catalog Mapping Closure — Decision Sheet v1

**Stand:** 2026-05-18, read-only Inventur.
**Quelle:** `v_pillar_generation_backfill_candidates WHERE decision='NO_CATALOG_MAPPING'`.
**Status:** Decision-first, keine automatische Mutation. Customer-Safe ist Release-Gate für SEO-Live-Enqueue.
**Anti-Drift North-Star:** Polizei wird **explizit excluded**, kein Catalog-Backfill.

## Catalog-Domänen (SSOT)
- **catalog_type:** Ausbildung, Branchenzertifikat, Fortbildung_IHK, Meister, Projektmanagement, Sachkunde, Sonstiges, Studium
- **chamber_type:** HWK, IHK, Privat, Staatlich, Universitaet
- **track:** AUSBILDUNG_VOLL, EXAM_FIRST, FACHWIRT, STUDIUM
- **recognition_type:** academic, chamber, private_industry, public_law, regulated_trade

## Decision Sheet (17 Packages)

| # | Package Title | package_id | Decision | catalog_type | chamber | track | recognition | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | AEVO – Ausbildereignungsprüfung | b960658d | MAP | Fortbildung_IHK | IHK | EXAM_FIRST | chamber | §30 BBiG, IHK-Prüfung |
| 2 | Anlagenmechaniker SHK | ef7ba3bf | MAP | Ausbildung | HWK | AUSBILDUNG_VOLL | chamber | Handwerk |
| 3 | Bankkaufmann/-frau | de6c5c13 | MAP | Ausbildung | IHK | AUSBILDUNG_VOLL | chamber | duale Ausbildung |
| 4 | Compliance Officer | d2000000-…-0014 | REVIEW | Branchenzertifikat | Privat | EXAM_FIRST | private_industry | synthetisches Skeleton; klären ob Live-Track |
| 5 | Fachinformatiker AE | 24c3793c | MAP | Ausbildung | IHK | AUSBILDUNG_VOLL | chamber | duale Ausbildung |
| 6 | Fachinformatiker SI | 96d0fb31 | MAP | Ausbildung | IHK | AUSBILDUNG_VOLL | chamber | duale Ausbildung |
| 7 | Immobiliardarlehensvermittler §34i | 3e070545 | MAP | Sachkunde | IHK | EXAM_FIRST | regulated_trade | GewO §34i |
| 8 | Immobilienmakler §34c | fa931e34 | MAP | Sachkunde | IHK | EXAM_FIRST | regulated_trade | GewO §34c |
| 9 | Industriekaufmann/-frau | f5e3403b | MAP | Ausbildung | IHK | AUSBILDUNG_VOLL | chamber | duale Ausbildung |
| 10 | Kaufleute Umwelt/Nachhaltigkeit | d2000000-…-0006 | REVIEW | Ausbildung | IHK | AUSBILDUNG_VOLL | chamber | neuer Beruf 2024; synthetisches Skeleton |
| 11 | Kaufmann/-frau Einzelhandel | 72a6f69d | MAP | Ausbildung | IHK | AUSBILDUNG_VOLL | chamber | duale Ausbildung |
| 12 | Koch/Köchin | a02cde5e | MAP | Ausbildung | IHK | AUSBILDUNG_VOLL | chamber | duale Ausbildung |
| 13 | Personalfachkaufmann/-frau IHK | 176f51ad | MAP | Fortbildung_IHK | IHK | FACHWIRT | chamber | DQR 6 |
| 14 | **Polizeivollzugsdienst (Theorie)** | d2000000-…-0004 | **EXCLUDE** | — | — | — | — | **Anti-Drift North-Star** |
| 15 | Scrum Master PSM I | 65430b12 | MAP | Branchenzertifikat | Privat | EXAM_FIRST | private_industry | Scrum.org Zertifikat |
| 16 | Verwaltungsfachangestellte/-r | be7aa766 | MAP | Ausbildung | Staatlich | AUSBILDUNG_VOLL | public_law | öffentl. Dienst |
| 17 | Wohnimmobilienverwalter §26a WEG | dd000001-…-0005 | REVIEW | Sachkunde | IHK | EXAM_FIRST | regulated_trade | synthetisches Skeleton; WEG §26a |

## Zusammenfassung
- **13 MAP** — deterministisch, ready für Catalog-Insert mit known title/slug/track/chamber
- **3 REVIEW** — synthetische d2/dd-IDs (Skeleton-Packages); Produktentscheidung nötig (echtes Live-Produkt oder Backlog-Cleanup)
- **1 EXCLUDE** — Polizei (Anti-Drift)

## Hard Gates vor Mutation
1. **Customer-Safe-First** noch nicht abgeschlossen (3 Wave-3-Residual Packages building/done, 0 published)
2. **Audit-Contract** für Catalog-Insert nicht registriert (`certification_catalog_seed`?)
3. **Pricing/Delivery-SSOT-Check** pro Package: nicht jedes „published" ist „sellable+deliverable"
4. **Slug-Strategie** pro Catalog-Row: aus `package_key` ableiten oder neu vergeben?
5. **linked_certification_id** = `course_packages.certification_id` (1:1 Bridge, FK-Check)

## Nächster Schritt (vorbereitend, NICHT live)
- Smoke-Query: für jedes MAP-Package prüfen, ob `certification_id` bereits in `certification_seo_pages` indirekt referenziert wird (Doppel-Pillar-Risiko)
- Slug-Vorschau: aus Package-Title + chamber generieren
- Migration-Skizze als separater Cut, gated auf:
  - alle 3 Wave-3-Residual Packages = published+sellable
  - Audit-Contract `certification_catalog_seed` registriert
  - REVIEW-Entscheidungen für #4/#10/#17 vom Product Owner bestätigt

## Open Decisions für PO
1. Compliance Officer — eigener Live-Track oder Backlog?
2. Kaufleute Umwelt/Nachhaltigkeit — Live ab wann? (neuer Beruf 2024)
3. Wohnimmobilienverwalter §26a — eigenes Sachkunde-Produkt oder Bundle mit §34c?
4. Polizei — bestätigt EXCLUDE (kein Catalog, kein Pillar, kein SEO-Push)?
