---
name: Phase A — Pillar Publish Integrity v1
description: SEO-Pillar als Teil des Publish-SSOT. Job-Type package_seo_pillar_ensure nach auto_publish, Skeleton-only (governance-first), source_package_id Pflicht-Bridge, 6 Cockpit-Views, Catalog-Guard mit Legacy-Grandfathering. Worker + Card live 2026-05-21. Wave 4 Realignment (60 keywords) + Phase C Catalog (Bank/Pflege) seeded.
type: feature
---

# Phase A — SEO Publish Integrity (Worker + Card + Wave 4 + Catalog seeded)

## SSOT
- **Pillar-Tabelle**: `public.blog_articles` (article_type=`pillar_guide`).
- **Bridge**: `blog_articles.source_package_id` — Pflicht via Skeleton-Generator.
- **Worker**: `supabase/functions/package-seo-pillar-ensure/index.ts` — ruft `fn_seo_pillar_ensure_skeleton(_package_id)`, schreibt `auto_heal_log` action_type `seo_pillar_ensure_run`.
- **job-map**: `package_seo_pillar_ensure → pool=growth, edgeFunction=package-seo-pillar-ensure`.
- **Cockpit-Card**: `src/components/admin/heal/cards/PillarCoverageCard.tsx` (gemounted in HealCockpitTabContent direkt vor PillarGenerationBackfillCard).

## RPCs (alle SECURITY DEFINER + has_role)
- `admin_get_pillar_coverage_summary()` — KPI-Bundle (jsonb)
- `admin_get_published_without_pillar(limit)` — Drilldown
- `admin_dispatch_pillar_ensure_for_package(uuid)` — Manual-Heal
- `admin_backfill_pillar_source_package_id(dry_run)` — Bulk-Heal Orphans
- `fn_seo_pillar_ensure_skeleton(uuid)` — idempotenter Skeleton-Generator

## Guards
- `trg_guard_publish_requires_catalog_entry` (BEFORE UPDATE OF status): blockt erstmaligen Publish ohne `certification_id` ODER ohne `certification_catalog`-Eintrag. Legacy 190 grandfathered via `feature_flags.publish_legacy_grandfathered=true`.

## Phase B Wave 4 — Keyword Realignment (Migration 20260521 21:16)
60 neue Keywords in `growth_keyword_registry` (20 Berufe × 3 Intents). Constraint-Map:
- `canonical_intent='informational'` (CHECK erlaubt nur info/nav/trans/comm/def/comp/prog)
- `owner_kind='reserved'`
- `status='reserved'`
- Sub-Intent (`abschlusspruefung` | `zwischenpruefung` | `pruefung-ihk`) im `keyword_slug`-Suffix UND in `notes` (`wave4:<sub_intent> | catalog=<slug> | beruf=<label>`).

## Phase C Catalog Bootstrap
- `certification_catalog`: Bankkaufmann/-frau (IHK, chamber) + Pflegefachmann/-frau (Staatlich, public_law). slug=`bankkaufmann-ihk` / `pflegefachmann`. priority_score 8.5 / 7.0. Notes: `Phase C bootstrap 2026-05-21 — Package + pricing pending`.
- **Voraussetzung erfüllt** für späteren Publish. Course-Package + Pricing + Auto-Build-Pipeline noch offen (separate Welle).

## Constraint-Lehren (für künftige Migrationen)
- `certification_catalog.catalog_type` ∈ {Ausbildung, Branchenzertifikat, Fortbildung_IHK, Meister, Projektmanagement, Sachkunde, Sonstiges, Studium}
- `certification_catalog.chamber_type` ∈ {HWK, IHK, Privat, Staatlich, Universitaet} — NICHT `KEINE`
- `certification_catalog.recognition_type` ∈ {private_industry, chamber, public_law, academic, regulated_trade} — NICHT `staatlich_anerkannt`
- `certification_catalog` hat zwar UNIQUE(slug), aber ON CONFLICT(slug) schlug fehl → NOT EXISTS-Pattern bevorzugen.
- `growth_keyword_registry.canonical_intent` Whitelist (siehe oben). Status nur {active, deprecated, reserved}.

## Baseline 2026-05-21 nach Run
- 190 published, 19 pillars (`pillar_guide`), 0 linked → 19 orphans (Backfill via Card pending).
- 60 Wave-4 Keywords reserved.
- 2 neue Catalog-Einträge (Bank/Pflege).

## Verbleibend
- Backfill-Run über PillarCoverageCard (dry → live, Reason ≥5).
- Wave 4 Content-Strategie: Welche Sub-Intents bekommen eigene Pillars vs H2-Sektionen in PF-Pillar?
- Phase C Course-Packages: Curricula erstellen → setup_course_package → Build-Pipeline → publish (auto-baut dann Catalog-Bridge + Pillar-Skeleton).
