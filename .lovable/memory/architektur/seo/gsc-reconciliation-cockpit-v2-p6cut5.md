---
name: P6 Cut 5 v2 — GSC Reconciliation Cockpit (read-only)
description: Read-only Paste-Box-Cockpit über admin_reconcile_gsc_urls. 9 Decision-Tiles, Drilldown mit expected_action, CSV-Export, manueller GSC-Inspect-Link. Keine Auto-API, keine Sitemap/Policy-Mutation.
type: feature
---

# P6 Cut 5 v2 — GSC Reconciliation Cockpit (read-only)

## Komponente
`src/features/admin/components/GscReconciliationCard.tsx`
Mount: `src/pages/admin/v2/GrowthPage.tsx` (Tab `audit`).

## Verhalten (Hard-Constraints)
- **Read-only**: keine Mutation an Sitemap-Views oder `route_crawl_policy`.
- **Kein Google-API-Call**: „In GSC prüfen" öffnet nur
  `https://search.google.com/search-console/inspect?...` in neuem Tab.
- **Persistenz**: ausschließlich Run-Audit `gsc_reconciliation_run`
  (geschrieben durch RPC `admin_reconcile_gsc_urls`). Keine Speicherung
  der eingegebenen URLs in `gsc_problem_urls`.
- Paste-Format: eine URL pro Zeile, optional `<TAB>` / `,` / `;` +
  GSC-Status (`indexed`, `noindex`, `redirect`, `404`, `soft_404`,
  `canonical`).

## UI
- 1× Paste-Box + „Reconcile starten"
- 1× „Alle"-Tile + 9 Decision-Tiles in `DECISION_ORDER`
  (Probleme zuerst: unexpected_404 → blocked_by_policy →
  missing_from_sitemap → unclassified → valid → erwartet).
- Drilldown-Tabelle: Pfad, GSC, Decision-Badge, `expected_action`,
  matched_state/pattern, in_sitemap, manueller GSC-Inspect-Link.
- CSV-Export der gefilterten Zeilen (Dateiname enthält Filter + ISO).

## Anti-patterns
- ❌ Direkter Tabellen-SELECT auf `gsc_problem_urls` /
  `v_gsc_reconciliation` (Cut 4 v1 SSOT bleibt parallel bestehen,
  aber dieses Cockpit ist v2-only).
- ❌ Schreibender Aufruf gegen `route_crawl_policy` oder
  Sitemap-Views aus dieser Komponente.
- ❌ Auto-Submit gegen Google Search Console API.

## Nächster Cut (offen)
Entscheidung zwischen:
- Cut 6a — Package Canonical Consolidation Guard
- Cut 6b — Post-Cutover Prerender Smoke
