---
name: VerwaltungsOS Executive Cockpit v1
description: Premium Mission-Control — eine Server-Aggregation für DailyBrief + Risks + Reality + parallele Live-Calls für NINA und Arbeitsmarkt
type: feature
---

# VerwaltungsOS Executive Cockpit v1 — FROZEN 2026-05-28

Schließt L3 aus dem Audit: alle bestehenden VerwaltungsOS-Schichten
(DailyBrief · Risks · Reality-Bridge · Bund-Lagebild · Arbeitsmarkt)
sind erstmals auf **einer** Admin-Surface verkabelt.

## Architektur (kein neues Schreibsystem)

- **RPC** `public.verwaltung_executive_cockpit(_window_days)` — admin-gated
  (`has_role(_uid,'admin')`). Wrappt server-side die drei bestehenden RPCs
  (executive · governance_risks · reality_bridge) zu einem Payload
  `{window_days, generated_at, executive, risks, reality}`. Reduziert N+1.
- **Reader-Lib** `getVerwaltungExecutiveCockpit(windowDays)` →
  `VExecutiveCockpit`.
- **UI** `/admin/verwaltung/cockpit` — Premium-Layout: Hero-KPI-Strip,
  2/3-Split Reality-Priorität × NINA-Lagebild, 2-col Cluster-Heat ×
  Risk-Grid, Hotspots-Tabelle. Live-Arbeitsmarkt-Trend pro Top-4
  Reality-Department parallel via `verwaltung-arbeitsmarkt` Edge.
  NINA-Live via `verwaltung-bund-lagebild` Edge.
- **Cross-Link** DailyBrief-Header → Cockpit + Cockpit-Hero/Hotspots → Drilldown.

## Anti-Drift (hard rules)

1. Cockpit-RPC schreibt nichts und ruft keine Bund-APIs — DB bleibt SSOT-frei.
2. NINA + Arbeitsmarkt laufen client-side parallel über die existierenden Edges
   (Pass-Through, 5-Min-Cache, Source-Attribution unverändert).
3. Cockpit darf nicht aufgesplittet werden in mehrere RPCs — Single-Payload-SSOT.
4. Erweiterungen (neue Karten / neue Layer) erfordern Migration + Reader-Lib + Smoke.
5. Tokens-only Styling (`status-bg-*`, `shadow-elev-1`, `surface-*`) — kein bg-X/10.

## Smoke (GREEN 2026-05-28)

`scripts/verwaltung-cockpit-smoke.mjs`:
- anon → 401/forbidden
- service-role → 200 + JSON (Body `forbidden` weil kein auth.uid — Gate-by-Design).

## Offen (nicht in v1)

- DNA-Backfill (roles/processes/kpis) erst danach → Reality-Bridge wird automatisch reicher.
- ARS-Geo-Bridge zwischen Oral-Session und NINA/Pegel.
- Cluster-Drilldown direkt aus Cockpit-Cluster-Heat-Card.
