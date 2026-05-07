---
name: Phase 2C Content Graph Backfill (Dry-Run-first)
description: Preview-/Run-RPC zum Backfill von Blog/SEO/Cert/Product-Landing-Assets als growth_content_graph_nodes ohne automatische Funnel/Money-Edges
type: feature
---
# Phase 2C Content Graph Backfill (Dry-Run-first)

## RPCs (admin-gated, SECURITY DEFINER, search_path=public, REVOKE PUBLIC/anon)
- `admin_preview_content_graph_backfill()` — totals + per_source (candidates_total, invalid, existing, new) + sample 25 (read-only).
- `admin_run_content_graph_backfill(p_limit int DEFAULT 50, p_dry_run boolean DEFAULT true)` — bei dry_run keine Writes, sonst max p_limit Inserts. Idempotent über `node_slug` (existing → skipped, kein Update). Loggt jeden Lauf in `auto_heal_log` (action_type=`growth_content_graph_backfill`, metadata enthält dry_run, processed, would_insert, inserted, skipped_existing, invalid, per_source).

## Quellen + node_slug-Schema
- `blog_articles` → `blog/<slug>` (asset_type=blog, owner_kind=blog)
- `seo_content_pages` → `seo/<slug>` (asset_type=landing, owner_kind=seo_page)
- `certification_seo_pages` → `cert/<slug>` (asset_type=landing, owner_kind=seo_page)
- `product_landing_profiles` → `product-landing/<id>` (asset_type=product, owner_kind=product_page)

## Invariante
- Backfill erzeugt ausschließlich Nodes, KEINE Funnel/Money/Cluster-Edges. Edges erst Phase 2D+ kontrolliert.
- `status` neuer Nodes immer `draft`.
- Existing Node wird NICHT überschrieben (skipped_existing) — verhindert ungewollten Drift.

## Verifikation
- Migration kompiliert grün, RPCs existieren.
- read_query (ohne admin-JWT) liefert `permission denied for function` → Admin-Gate aktiv.
- UI/Cron noch nicht — kommt in Phase 2D Leitstelle Backfill-Control.
