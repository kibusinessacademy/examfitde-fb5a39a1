---
name: Phase 2E Content Graph Edge Planning (Read-Only)
description: admin_preview_content_graph_edge_plan schlägt money_page/funnel_next Edges mit Confidence high/medium/low vor — schreibt nichts
type: feature
---
# Phase 2E · Content Graph Edge Planning (Read-Only)

## RPC
`admin_preview_content_graph_edge_plan(p_limit_per_node int DEFAULT 3, p_max_nodes int DEFAULT 100)`
- Admin-gated, SECURITY DEFINER, search_path=public, REVOKE PUBLIC/anon, GRANT authenticated+service_role.
- **Schreibt KEINE Edges, KEIN auto_heal_log** — pure Read-Only-Vorschauen.

## Rückgabe (jsonb)
```
{ generated_at, params, totals: { nodes_missing_money, nodes_missing_funnel, proposals_high/medium/low/total },
  nodes: [{ from_node_id, from_slug, from_title, from_asset, high_count, medium_count, low_count,
            proposals: [{ to_node_slug, to_title, edge_type, confidence, reason }] }] }
```

## Confidence-Modell
### money_page (Source ≠ asset_type=product → Target product)
- **high**: source.keyword_slug = target.keyword_slug AND exactly ein product-Node mit diesem keyword_slug.
- **medium**: shared keyword_slug (multi-candidate) ODER shared cluster_id.
- **low**: shared persona / generic fallback.

### funnel_next (Target asset_type ∈ landing/product/hub, ≠ source)
- **medium**: shared keyword_slug ODER cluster_id.
- **low**: nur persona-Match.
- Sortierung priorisiert product > landing > hub und keyword_slug-Match.

## Constraints
- Kein Auto-Linking. Phase 2F „Apply selected edges" folgt manuell.
- Existierende Outbound-Edges blocken Vorschläge per from_node × edge_type.
- Limits hart: limit_per_node 1..10, max_nodes 1..500.

## Verifikation
- read_query (ohne admin-JWT) → `permission denied for function` → Gate aktiv.
