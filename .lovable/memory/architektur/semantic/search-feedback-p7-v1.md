---
name: P7 Search Console Feedback Loop + Indexability Evidence
description: Aggregated Search Feedback SSOT for /wissen routes, admin RPCs, import contract, guard and audit UI. Measurement-only: no auto content mutation.
type: feature
---

# P7 — Search Feedback Loop + Indexability Evidence

## SSOT
- `public.semantic_route_search_metrics` stores aggregated route-level Search Console metrics for `/wissen/{beruf,kompetenz,pruefung}/:key`.
- Allowed sources: `gsc`, `manual_gsc_export`.
- Stored data is aggregate-only: impressions, clicks, CTR, average position, query_count and primitive-safe metadata.
- Raw query dumps, credentials, tokens, API keys and PII-shaped metadata are forbidden.

## Derived health
- `public.v_semantic_route_search_health` combines the published semantic graph with route metrics.
- It classifies routes into `performing`, `impressions_no_clicks`, `no_search_signal`, `not_in_sitemap`, `not_in_graph`, and `needs_observation`.
- Recommended actions are diagnostic only: `none`, `improve_snippet`, `wait_for_indexing`, `check_sitemap`, `check_graph_route`, `review_search_intent`.

## RPCs
- `admin_semantic_search_health()` returns summary KPIs, top routes and an attention queue.
- `admin_semantic_route_search_detail(route_path)` returns route-level daily history for up to 90 days.
- `admin_import_semantic_search_metrics(payload)` validates and idempotently imports aggregated `/wissen/...` route metrics.
- All RPCs are admin/service-role gated. The UI must use RPCs only and must not read tables or views directly.

## Import contract
Example payload:

```json
{
  "source": "gsc",
  "rows": [
    {
      "route_path": "/wissen/beruf/industriekaufmann",
      "date": "2026-05-20",
      "impressions": 120,
      "clicks": 8,
      "avg_position": 12.4
    }
  ]
}
```

Rules:
- Only `/wissen/beruf/*`, `/wissen/kompetenz/*`, `/wissen/pruefung/*` are accepted.
- Route must exist in the current published semantic graph.
- Negative values and `clicks > impressions` are rejected.
- Duplicate `(route_path, date, source)` rows are upserted idempotently.
- Metadata is sanitized and primitive-only.

## UI
- `SemanticSearchFeedbackCard` is mounted in the Growth audit tab next to the P6 crawl observatory card.
- It shows total routes, performing routes, routes without search signal, impressions-without-clicks, 28-day impressions/clicks/CTR, top routes and attention queue.
- It supports JSON import through the admin RPC. It does not edit content, titles, snippets or SEO pages.

## Guard
- `scripts/guards/semantic-search-feedback-guard.mjs` enforces the P7 contract:
  - no direct client/table reads on `semantic_route_search_metrics`
  - no direct reads on `v_semantic_route_search_health`
  - no GSC/API secret patterns
  - no raw query dumps outside the allowed helper/migration/guard surface
  - no automatic content mutation from search metrics
  - import contract remains `/wissen/...` scoped

## Tests
- `src/__tests__/semantic-search-feedback.golden.test.ts` covers route parsing, search-state classification, recommended actions, CTR math, raw-query rejection and secret-shaped metadata rejection.

## Anti-patterns
- Do not store raw GSC queries.
- Do not store API credentials or OAuth tokens in DB/UI/audit.
- Do not auto-rewrite SEO content from metrics.
- Do not import non-knowledge routes.
- Do not bypass admin RPCs from the client.

## Open for P7b
- Real GSC API importer via edge function, only after secret handling and OAuth/token storage decisions are explicitly scoped.
- Optional detailed route drilldown drawer.
- Optional CSV-to-JSON helper for manual GSC exports.
