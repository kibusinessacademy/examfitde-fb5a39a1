---
name: SEO Dead-End Coverage E3d v1
description: SSOT v_seo_dead_end_coverage + admin_get_seo_dead_end_coverage RPC + fail-soft pillar publish trigger. Read-only Coverage-Gate über Package↔Pillar↔Spokes↔Blog↔Internal-Links. Baseline 2026-05-17: 187/190 dead-end (170 PILLAR_NOT_LINKED_TO_PACKAGE, 17 NO_PILLAR, 3 INTERNAL_LINKS_MISSING).
type: feature
---

# E3d — Pillar↔Package Coverage Gate + SEO Dead-End Guard

## Wahrheit
Pro published `course_package` (1 Zeile) eine Klassifizierung über 9 Stati:
OK, NO_PRODUCT_PAGE, NO_PILLAR, PILLAR_NOT_LINKED_TO_PACKAGE, PILLAR_NOT_PUBLISHED,
NO_SPOKES, SPOKES_NOT_PUBLISHED, BLOG_CONTEXTUAL_LINKS_BLOCKED, INTERNAL_LINKS_MISSING.

`is_seo_dead_end = true` ⇔ Produkt fehlt oder Pillar fehlt/unpublished.
Sekundär-Drift (Spokes, Blog, Internal Links) ist Status, aber kein Dead-End.

## SSOT
- View `v_seo_dead_end_coverage` (service_role only)
- RPC `admin_get_seo_dead_end_coverage(p_status, p_limit≤500)` — admin-gated, read-only
- Trigger `trg_guard_seo_pillar_publish_dead_end` BEFORE INSERT OR UPDATE OF is_published
  ON certification_seo_pages — fail-soft (RETURN NEW immer), audited via fn_emit_audit
- 4 Audit-Contracts registriert in `ops_audit_contract`

## UI
`SeoDeadEndCoverageCard` im Heal-Cockpit. Read-only: Filter (Status), Limit, Refresh, CSV.
Keine direkten Table-Reads — nur RPC.

## Baseline 2026-05-17 (Post-E3c)
- Total published: 190
- OK: 0
- Dead-end: 187 (170 PILLAR_NOT_LINKED_TO_PACKAGE, 17 NO_PILLAR)
- Internal-links-missing: 3
- Truth: Pillar-Generation für gemappte Catalogs ist der nächste Engpass,
  nicht Blog-Publishing-Drift.

## Folge-Cuts
- E3e: Blog Publishing Convergence Worker
- E3f: Pillar-Generation-Backfill (für PILLAR_NOT_LINKED_TO_PACKAGE)

## Guards
- `scripts/guards/seo-dead-end-coverage-guard.mjs` — blockt direkte Mutationen
  auf certification_seo_pages / seo_content_pages / v_seo_dead_end_coverage in src/
- Contract-Pin `src/__tests__/e3d-seo-dead-end-coverage.contract.test.ts`
