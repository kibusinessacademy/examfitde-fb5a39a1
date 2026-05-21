---
name: Phase A — Pillar Publish Integrity v1
description: SEO-Pillar als Teil des Publish-SSOT. Job-Type package_seo_pillar_ensure nach auto_publish, Skeleton-only (governance-first), source_package_id Pflicht-Bridge, 6 Cockpit-Views, Catalog-Guard mit Legacy-Grandfathering.
type: feature
---

# Phase A — SEO Publish Integrity

## SSOT
- **Pillar-Tabelle**: `public.blog_articles` (kein separates `seo_pillars`).
- **Bridge**: `blog_articles.source_package_id` — Pflicht für neue Pillars via Skeleton-Generator.
- **Typed View**: `v_seo_pillars` filtert auf `pruefungsfragen-%-pillar-guide` + `pruefungsvorbereitung-%-pillar-guide`, exposed `intent_key`.

## Pipeline
- Neuer Job-Type `package_seo_pillar_ensure` (pool=growth, lane=growth, requires_package_id=true).
- DAG-Edge: `package_seo_pillar_ensure dependsOn auto_publish`. NIE davor.
- Trigger `trg_enqueue_pillar_ensure_on_publish` (AFTER UPDATE OF status) enqueued idempotent pro Paket beim Publish-Transition.
- Skeleton-Generator `fn_seo_pillar_ensure_skeleton(package_id)`: erzeugt PF + PV Rows status=`reserved` mit source_package_id. **KEIN Auto-Publish von AI-Content.** Operator approved manuell.

## Guards
- `trg_guard_publish_requires_catalog_entry` (BEFORE UPDATE OF status): blockt erstmaligen Publish ohne certification_id ODER ohne certification_catalog-Eintrag. Legacy 190 Pakete grandfathered via `feature_flags.publish_legacy_grandfathered=true`.

## Heal
- `admin_backfill_pillar_source_package_id(dry_run=true)`: slug-fuzzy-match (token vs package_key/title nach Translit+Normalize). Unmatched → audit `pillar_orphan_detected`. Audit: `pillar_source_package_backfill`.

## Cockpit-Views (alle REVOKE PUBLIC/anon/authenticated, GRANT service_role)
- `v_published_without_pillar` (gap_kind: MISSING_BOTH/MISSING_PF/MISSING_PV)
- `v_pillar_orphans` (orphan_reason: NO_SOURCE_PACKAGE / SOURCE_PACKAGE_MISSING / SOURCE_PACKAGE_NOT_PUBLISHED)
- `v_duplicate_keyword_targets`
- `v_pillar_generation_backlog` (reserved/planned/drafting/review_required + hours_in_state)
- `v_pillar_missing_internal_links` (published, <4 links)
- `v_pillar_content_stale` (published, updated >180d)

## Admin-RPCs (SECURITY DEFINER + has_role)
- `admin_get_pillar_coverage_summary()` — KPI-Bundle
- `admin_get_published_without_pillar(limit)` — Drilldown
- `admin_dispatch_pillar_ensure_for_package(uuid)` — Manual-Heal mit Audit
- `admin_backfill_pillar_source_package_id(dry_run)` — Bulk-Heal

## Baseline 2026-05-21
- 190 published, 19 pillars, 0 mit source_package_id → 19 orphans / 190 missing.
- Erster Schritt: `SELECT admin_backfill_pillar_source_package_id(true)` (dry-run), prüfen, dann `false`.

## Keyword Registry State Machine
Erweiterte Zustände in `growth_keyword_registry.status` (free-text, governance via Code):
`reserved → planned → drafting → generated → review_required → published → archived`.

## Verbleibend (nicht Phase A)
- Cockpit-UI-Card `PillarCoverageCard` (Admin Heal-Cockpit Sektion 3).
- Edge-Function `package-seo-pillar-ensure` Worker (ruft `fn_seo_pillar_ensure_skeleton`).
- Phase B: Wave 4 Realignment auf `abschlussprüfung + beruf` / `zwischenprüfung + jahr` / `prüfung + beruf + ihk`.
- Phase C: Bank/Pflege Catalog-Entries + erste Publishes.
