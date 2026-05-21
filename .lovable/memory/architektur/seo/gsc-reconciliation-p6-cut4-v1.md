---
name: P6 Cut 4 — GSC Reconciliation & Validation Workflow
description: gsc_problem_urls + fn_classify_gsc_url against route_crawl_policy → 6 decisions, admin RPCs, validation queue. Foundation for Cut 5 Admin Cockpit Card.
type: feature
---

# P6 Cut 4 — GSC Reconciliation

## SSOT-Tabellen
- `public.gsc_problem_urls` — raw GSC-Findings (url UNIQUE, path, gsc_status,
  coverage_state, last_crawled_at, source_report, batch_id, validation_status,
  validation_requested_at). RLS: service_role only.
- `public.gsc_reconciliation_audit` — append-only Snapshots (url, decision,
  matched_pattern, matched_state, classified_at). service_role only.

## Decision-Enum `gsc_reconciliation_decision`
- `valid` — Policy=index UND GSC sagt valid/indexed
- `expected_noindex` — Policy=noindex (GSC-Fund ist erwartet)
- `expected_redirect` — Policy=redirect (GSC sieht alte URL, Redirect existiert)
- `gone_expected` — Policy=gone
- `needs_fix` — Policy=index ABER GSC meldet Fehler (echtes Problem)
- `unclassified_needs_fix` — kein Policy-Match (Drift: weder index noch noindex)

## Validation-Workflow `gsc_validation_status`
- `pending` (default) → `requested` (Admin klickt „Fehlerbehebung prüfen") →
  `validated` / `still_failing` (späterer GSC-Sync setzt das).

## Classifier `fn_classify_gsc_url(path, gsc_status)`
- STABLE SECURITY DEFINER, service_role only.
- Match-Reihenfolge: **exact → longest-prefix → regex**.
- Mapped Policy-State → Decision (siehe oben).

## View + Admin-RPCs (alle has_role-gated)
- `v_gsc_reconciliation` — JOIN gsc_problem_urls × LATERAL fn_classify_gsc_url.
- `admin_ingest_gsc_problem_urls(rows jsonb)` — bulk-upsert,
  Audit `gsc_problem_urls_ingested` (batch_id, count, source).
- `admin_get_gsc_reconciliation_summary()` — Counts pro decision +
  pending/requested-Splits.
- `admin_get_gsc_reconciliation_detail(decision?, limit, offset)` — Drilldown.
- `admin_mark_gsc_url_for_validation(url)` — setzt validation_status=requested,
  Audit `gsc_url_validation_requested` (url, decision).

## Audit-Contracts
Registriert in `ops_audit_contract`:
- `gsc_problem_urls_ingested` → required_keys `{batch_id, count, source}`
- `gsc_url_validation_requested` → required_keys `{url, decision}`

## Anti-patterns
- ❌ Direkter Client-SELECT auf `gsc_problem_urls` oder
  `v_gsc_reconciliation` — nur via Admin-RPC.
- ❌ Klassifizierung in Edge/Client. Single source of truth ist
  `fn_classify_gsc_url` gegen `route_crawl_policy`.
- ❌ Validation-Workflow ohne Audit.

## Nächster Cut (5, sofort, ohne Rückfrage)
Admin SEO Cockpit Card:
- Summary-Stripe (6 Decision-Counts mit Tone),
- Drilldown-Table (Filter pro Decision),
- Action „Fehlerbehebung prüfen" → `admin_mark_gsc_url_for_validation`,
- CSV-Export der gefilterten Tabelle,
- Mount im Growth-Tab neben `SemanticGraphCrawlHealthCard`.

Prerender/Vercel-Cutover bleibt separat.
