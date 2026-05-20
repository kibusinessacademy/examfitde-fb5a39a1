---
name: P6 Crawl Observatory + Incremental Regeneration
description: Run-history SSOT, freshness/coverage view, admin RPCs, idempotent dirty-event triggers — no direct client reads on semantic_graph_* tables.
type: feature
---

# P6 — Crawl Observatory + Incremental Regeneration Hooks

## SSOT
- `public.semantic_graph_materialization_runs` — every materializer invocation. Columns: `status`, `entity_count`, `edge_count`, `orphan_count`, `route_count`, `sitemap_route_count`, `error_code`, `error_message`, `metadata`. RLS: service_role only. **No anon/authenticated direct read** — RPC-gated.
- `public.v_semantic_graph_crawl_health` — derived single-row health (freshness_state, recommended_action, sitemap_coverage_ratio). Service-role only; consumed via RPC.

## RPCs (admin/service_role gated via `has_role(auth.uid(),'admin')`)
- `admin_semantic_graph_crawl_health()` → jsonb
- `admin_semantic_graph_materialization_history(_limit int default 20)` → jsonb
- `admin_semantic_graph_request_materialization(_reason text default 'manual_admin')` → jsonb. Idempotent per `(reason, 15-min bucket)`. Returns `active_job_present` when an open job exists in the window. Audits via `fn_emit_audit('semantic_graph_materialization_requested', ...)`.

## Job-Type
- Registered: `system_semantic_graph_materialize` (pool=core, lane=control, governance=true, requires_package_id=false). Worker dispatch already handles control lane.

## Triggers (incremental hooks)
- `tg_semantic_graph_enqueue_dirty(reason)` attached AFTER INSERT/UPDATE/DELETE on:
  - `certifications` (`certifications_changed`)
  - `curricula` (`curricula_changed`)
  - `learning_fields` (`learning_fields_changed`)
  - `competencies` (`competencies_changed`)
- Enqueues at most one `system_semantic_graph_materialize` job per `(reason, 15-min bucket)` via `idempotency_key`. Debounced 60 s. Triggers **never** invoke the edge function directly and **never** compute the graph.

## Materializer (edge function `semantic-graph-materializer`)
- Inserts a `started` run row, then transitions to `published | skipped_unchanged | failed`.
- On any failure inside the publish phase, deletes the draft snapshot — never leaves a half-published state.
- PII-safe error normalization: strips emails, caps to 240 chars, extracts `CODE:detail` prefix.

## Guards
- `scripts/guards/semantic-graph-crawlability-guard.mjs` + workflow `semantic-graph-crawlability-guard.yml`. Checks: `missing_published_graph`, `sitemap_missing_route`, `duplicate_wissen_route`, `invalid_route_key`, `orphan_route`, `route_builder_bypass`. Cold-start tolerant.
- Existing `semantic-graph-integrity-guard` remains the structural gate (dup, dangling, orphan).

## UI
- `src/features/admin/components/SemanticGraphCrawlHealthCard.tsx` — mounted in `GrowthPage` (audit tab). Reads exclusively via the three admin RPCs. Button "Materialisierung anfordern" → toast `created | active_job_present | failed`. Shows last 20 runs (status, counts, duration, error_code).

## Anti-patterns
- ❌ Client direct read on `semantic_graph_*` or `semantic_graph_materialization_runs`.
- ❌ Trigger directly invoking the edge function or computing the graph.
- ❌ Bypassing `admin_semantic_graph_request_materialization` to insert into `job_queue` from UI.
- ❌ Storing PII / raw row payloads in `metadata` or `error_message`.

## Tests / Acceptance
- `src/__tests__/semantic-graph-observatory.golden.test.ts` — freshness/recommended-action mapping, idempotency-bucket math, PII normalization.
- P1–P5 golden suites remain green.
- Integrity + crawlability guards both green.
