---
name: SEO Pillar Generation Backfill E3f v1
description: SSOT v_pillar_generation_backfill_candidates + admin_backfill_certification_pillars RPC (dry-run default, reason ≥10 chars für live, cap 100, idempotent, fail-soft). Baseline 2026-05-17: 170 READY_TO_GENERATE, 3 ALREADY_EXISTS, 17 NO_CATALOG_MAPPING, 249 PACKAGE_NOT_PUBLISHED.
type: feature
---

# E3f — Pillar-Generation-Backfill

## Wahrheit
Pro `course_package` (published + unpublished) eine Decision aus 7 Stati:
READY_TO_GENERATE, PILLAR_ALREADY_EXISTS, NO_CATALOG_MAPPING, AMBIGUOUS_MAPPING,
PACKAGE_NOT_PUBLISHED, PRODUCT_NOT_PUBLIC, SKIP_NOT_SELLABLE.

Catalog wird über `certification_catalog.linked_certification_id` aufgelöst.
Bei mehreren Treffern → AMBIGUOUS_MAPPING (kein Auto-Backfill).

## SSOT
- View `v_pillar_generation_backfill_candidates` (service_role only)
- RPC `admin_get_pillar_backfill_candidates(decision, limit≤1000)` — admin-gated
- RPC `admin_backfill_certification_pillars(limit≤100, dry_run=true, reason)` — admin-gated
  - Live requires `reason ≥ 10` chars
  - Idempotency: per-catalog EXISTS-check VOR jedem Insert (skipped+audit)
  - Fail-soft: per-row TRY/CATCH, summary mit attempted/created/skipped/failed
- 3 Audit-Contracts: `pillar_backfill_pillar_created/_skipped/_summary`

## Generierter Pillar (draft)
- `slug = catalog_slug || '-pruefung'`
- `title = catalog_title || ' Prüfungstrainer 2026 – 1.100+ Fragen'`
- `meta_title` + `meta_description` deterministisch
- `content_json` mit hero_headline/intro/target_persona/linked_package_id/linked_certification_id
- `is_published = false` — kein Auto-Publish; Publish-Gate bleibt unabhängig.

## UI
`PillarGenerationBackfillCard` im Heal-Cockpit (nach SeoDeadEndCoverageCard).
Filter (Decision) + Limit + Refresh + CSV + Dry-run-Button + Live-Backfill-Dialog (Reason-Pflicht).

## Baseline 2026-05-17 (Post-E3d)
- READY_TO_GENERATE: 170 (genau die 170 PILLAR_NOT_LINKED_TO_PACKAGE aus E3d)
- PILLAR_ALREADY_EXISTS: 3
- NO_CATALOG_MAPPING: 17 (= identisch zu E3d NO_PILLAR — echte Catalog-Gaps)
- PACKAGE_NOT_PUBLISHED: 249
- AMBIGUOUS_MAPPING: 0
- Catalog-Match-Duplikate: 0 (jeder Catalog mappt auf genau 1 Package)

## Guards
- `scripts/guards/pillar-generation-backfill-guard.mjs` — blockt
  direkte Mutationen auf certification_seo_pages und jede client-Verwendung
  der SSOT-View (Reads + Writes nur via RPC).

## Folge-Cuts
- Audit-Run der ersten Welle → 25 Pillars live
- Publish-Gate für gebackfillte Pillars (Quality-Score / Linkgraph)
- E3e: Blog Convergence (erst sinnvoll wenn Pillars existieren)
- E3g: Catalog-Backfill für die 17 NO_CATALOG_MAPPING Pakete
