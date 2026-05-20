---
name: P5 Knowledge Graph Materialization
description: DB-fed semantic graph SSOT — snapshots, atomic publish, orphan-guard, sitemap integration. Phase P5 of Pillar/SRO/SEO/LLM master plan.
type: feature
---

# P5 — Semantic Knowledge Graph Materialization

## SSOT
- `public.semantic_graph_snapshots` — immutable, exactly one `status='published'` at any time (partial unique index).
- `public.semantic_graph_entities` — `(snapshot_id, kind, key)` unique; `entity_id` is PK component.
- `public.semantic_graph_edges` — BEFORE-INSERT trigger `trg_guard_semantic_edge_no_orphan` enforces both endpoints live in the same snapshot.
- View `public.v_semantic_graph_current` — pointer to published snapshot.
- View `public.v_semantic_graph_orphans` — entities with neither incoming nor outgoing edges in published snapshot. Must stay empty.

## RPCs
- `public.semantic_graph_get_published()` — STABLE / SECURITY DEFINER / anon+authenticated execute. Returns `{snapshot_id, snapshot_at, source_hash, entity_count, edge_count, entities[], edges[]}` with stable ordering.
- `public.semantic_graph_publish_snapshot(uuid)` — SECURITY DEFINER / **service_role only**. Archives previous published + marks new as published.

## Materializer
- Edge function `supabase/functions/semantic-graph-materializer/index.ts`.
- Inputs: `certifications` → `beruf`, `learning_fields` (via `curricula.certification_id`) → `lernfeld`, `competencies` → `kompetenz`. Edges: `beruf_has_lernfeld`, `lernfeld_has_kompetenz`.
- `source_hash` = FNV-1a of stable-sorted entities+edges. Re-runs with unchanged hash skip publish (idempotent / "semantic freshness without SSR drift").
- Trigger: invoke `POST /functions/v1/semantic-graph-materializer` (optionally `{force:true}`). Recommended cadence: post-publish hook on curriculum/competency mutations, otherwise daily.

## Client / SSR
- `src/hooks/useKnowledgeGraph.ts` now async — single fetch per session via RPC, cached in module scope. SSR-safe: first paint sees empty graph, re-renders on resolve.
- Pillar pages (`/wissen/beruf/:key`, `/wissen/kompetenz/:key`, `/wissen/pruefung/:key`) already handle empty graph (P4).

## Sitemap (sitemap-only mode)
- `scripts/seo/load-dynamic-routes.mjs::loadWissenRoutes()` calls the public RPC and emits `/wissen/<seg>/<key>` entries.
- `scripts/seo/prerender.mjs` merges `wissen` routes into `buildSitemaps([...])` — NOT into per-route HTML, per `mem://architektur/seo/sitemap-only-mode-for-db-routes-v1`.
- Vercel/Netlify migration: routes auto-promote to per-route HTML when hosting respects `dist/<route>/index.html`.

## Guards
- `scripts/guards/semantic-graph-integrity-guard.mjs` — CI guard via RPC. Checks duplicate `(kind,key)`, dangling edge endpoints, graph orphans. Cold-start tolerant (entity_count=0 → OK). Workflow `.github/workflows/semantic-graph-integrity-guard.yml`.
- Golden test `src/__tests__/semantic-graph-materialization.golden.test.ts` — shape + orphan invariants on pure builder.

## Anti-patterns
- ❌ Writing to `semantic_graph_*` outside the materializer edge function.
- ❌ Bypassing `semantic_graph_publish_snapshot` (manual UPDATE on status).
- ❌ Caching graph snapshot in localStorage / sessionStorage — RPC is the SSOT.
- ❌ Rendering wissen pages from any source other than `useKnowledgeGraph` / RPC.
