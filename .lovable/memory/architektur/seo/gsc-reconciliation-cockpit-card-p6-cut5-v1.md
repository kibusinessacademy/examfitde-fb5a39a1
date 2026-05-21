---
name: P6 Cut 5 — Admin GSC Reconciliation Card
description: Cockpit-Card im Growth Audit-Tab mit 6 Decision-Tiles, Drilldown-Table, CSV-Export und „Fehlerbehebung prüfen" Action gegen admin_mark_gsc_url_for_validation.
type: feature
---

# P6 Cut 5 — GSC Reconciliation Cockpit Card

## Mount
`src/pages/admin/v2/GrowthPage.tsx` Tab `audit` → `<GscReconciliationCard />`
direkt unter `<SemanticGraphCrawlHealthCard />`.

## Komponente `src/features/admin/components/GscReconciliationCard.tsx`
- TanStack-Query Keys `gsc-recon-summary` + `gsc-recon-detail` (staleTime 30s).
- Konsumiert ausschließlich Admin-RPCs aus Cut 4:
  `admin_get_gsc_reconciliation_summary`, `admin_get_gsc_reconciliation_detail`,
  `admin_mark_gsc_url_for_validation`.
- 6 Decision-Tiles (`needs_fix`, `unclassified_needs_fix`, `expected_redirect`,
  `expected_noindex`, `gone_expected`, `valid`) als klickbare Filter
  (Toggle zurück auf `all`).
- Drilldown-Table: URL/Path, Decision-Badge, GSC-Status, matched policy
  (pattern/state/redirect_to), Validation-Status-Badge, Action-Button.
- Action „Fehlerbehebung prüfen" → `admin_mark_gsc_url_for_validation`,
  enabled nur für `needs_fix` / `unclassified_needs_fix` /
  `expected_redirect` und nur in `pending`/`still_failing`-Workflow.
- CSV-Export der aktuell gefilterten Tabelle via `toCsv` + `downloadCsv`
  (`lib/csv.ts`); Dateiname enthält Filter + ISO-Timestamp.
- Default-Filter `needs_fix` (das ist die einzige Decision mit echten
  Action-Items).

## Anti-patterns
- ❌ Kein direkter Tabellen-SELECT auf `gsc_problem_urls` /
  `v_gsc_reconciliation` aus der UI.
- ❌ Keine Mutationen ohne Toast + invalidateQueries für beide Keys.
- ❌ Keine Hardcoded-Decisions oder Klassifikation im Frontend — alle
  Entscheidungen kommen aus `fn_classify_gsc_url` (Cut 4 SSOT).

## Was als nächstes (separat)
- Vercel-Cutover + Per-Route Prerender — eigentlicher Indexierungs-Booster.
- GSC-API-Sync-Worker, der `admin_ingest_gsc_problem_urls` nightly füttert
  (statt manuell-CSV).
- GSC `urlInspection.index.inspect` Loop, der `validation_status=requested`
  in `validated`/`still_failing` auflöst.
