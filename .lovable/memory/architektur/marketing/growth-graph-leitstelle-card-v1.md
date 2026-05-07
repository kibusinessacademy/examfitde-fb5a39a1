---
name: GrowthGraphLeitstelleCard read-only
description: Admin-Leitstelle für Growth Content Graph. Liest admin_get_content_graph_summary + admin_get_content_graph_orphans, klassifiziert Severity (OK/P2/P1/P0) und empfiehlt nächste Aktion. Eingebunden im /admin/growth Audit-Tab oben. Keine Mutationen.
type: feature
---

`src/components/admin/growth/GrowthGraphLeitstelleCard.tsx` – read-only:

- StatTiles: Nodes total/active/draft, Edges total, Orphans, OK Nodes, Missing inbound/outbound/funnel_next/money_page.
- Severity-Heuristik: P0 wenn money_page fehlt; P1 wenn Orphan-Anteil >50% oder >10 missing funnel_next; P2 sonst; OK bei 0/0/0.
- Recommended Action je Severity.
- Top-25 Orphan-Tabelle (slug, asset_type, 4 Flag-Checks) mit ScrollArea.
- Loading-Skeleton + Error-State mit Retry + Manual Refresh (refetch beider RPCs).
- React Query, staleTime 60s.
- Eingebunden in `src/pages/admin/v2/GrowthPage.tsx` Audit-Tab als erste Card.

Verboten: Editieren, Backfill, Auto-Heal. Keine neuen DB-Tabellen. Phase 2C Backfill ist nächster Schritt.
