---
name: Growth OS Phase 2B – Content Graph SSOT
description: growth_content_graph_nodes/_edges + admin RPCs + orphan guard (warn-only). Locked to service_role; admin access only via SECURITY DEFINER RPCs with has_role gate.
type: feature
---

Tabellen `growth_content_graph_nodes` (slug-uniq active) + `growth_content_graph_edges` (uniq from/to/edge_type, no self-loop). Edges: internal_link | funnel_next | money_page | related | canonical_parent.

RPCs (alle SECURITY DEFINER + has_role admin + auto_heal_log Audit):
- `admin_register_content_node(...)` – upsert by node_slug
- `admin_link_content_nodes(from,to,edge_type,...)` – ON CONFLICT update priority/anchor/metadata
- `admin_get_content_graph_orphans()` – flags missing_inbound/outbound/funnel_next/money_page
- `admin_get_content_graph_summary()` – counts by asset_type/edge_type

Guard `scripts/guards/content-graph-orphan-guard.mjs` warn-only (STRICT=1 für hard-fail). CI: PR + daily 06:00 UTC. Kein Backfill, keine UI, keine Programmatic-SEO in diesem PR – Phase 2C folgt.
