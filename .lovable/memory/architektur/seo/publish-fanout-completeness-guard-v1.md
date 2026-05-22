---
name: Publish-Fanout-Completeness Guard v1
description: P2 Forward-Ratchet — Trigger trg_guard_publish_requires_fanout blockt Erst-Publish ohne catalog_entry+pillar_article+active_public_product. Legacy 190 grandfathered. SSOT v_publish_fanout_completeness + RPC admin_check_publish_fanout_completeness + CI-Guard scripts/guards/publish-fanout-completeness-guard.mjs (6h cron).
type: feature
---

# P2 Publish-Fanout-Completeness Guard

## SSOT
- **View** `public.v_publish_fanout_completeness` — pro Paket: `has_catalog_entry`, `has_pillar_article`, `has_active_public_product`, `missing_components[]`. service_role-only.
- **RPC** `public.admin_check_publish_fanout_completeness()` SECURITY DEFINER + `has_role(admin)`. Liefert `{summary, missing_packages, generated_at}`.
- **Trigger** `trg_guard_publish_requires_fanout` BEFORE UPDATE OF status auf `course_packages`. Aktiviert nur bei Übergang nach `published` (Erst-Publish), skipt Re-Publish und `session_replication_role='replica'`.
- **Bypass** `feature_flags.publish_legacy_grandfathered=true` — alle 190 published Pakete (Stand 2026-05-22) sind getaggt.
- **Audit** `auto_heal_log` action_type `publish_fanout_completeness_check` (required: `package_id`, `missing_components`).

## Pflicht-Fanout (3 Komponenten)
| Komponente | Quelle |
|---|---|
| catalog_entry | `certification_catalog.id = course_packages.certification_id` |
| pillar_article | `blog_articles.source_package_id = course_packages.id AND article_type='pillar_guide'` |
| active_public_product | `products.curriculum_id = course_packages.curriculum_id AND status='active' AND visibility='public'` |

## CI-Guard
- `scripts/guards/publish-fanout-completeness-guard.mjs` ruft RPC, fail bei `offenders > PUBLISH_FANOUT_GUARD_ALLOW` (default 0). Skipt bei fehlendem `SUPABASE_SERVICE_ROLE_KEY`.
- Workflow `.github/workflows/publish-fanout-completeness-guard.yml` läuft auf push/PR + alle 6h.

## Baseline 2026-05-22
- 190 published, alle legacy_grandfathered → strict_scope=0 → guard green.
- Wirkung ab erstem nicht-grandfathered Publish (Phase C: Bank/Pflege Course-Packages).

## Bezug
- Phase A Pillar Publish Integrity v1 (Bridge `source_package_id`).
- `trg_guard_publish_requires_catalog_entry` (Catalog-only Vorgänger).
- `trg_guard_publish_requires_pricing` (orthogonale Pricing-Schicht).
