---
name: VerwaltungsOS DailyBrief v1
description: Read-only Continuous Governance Intelligence aus Oral-Bridge-Realdaten — Executive-, Cluster-, Risk- und Fachbereichs-Briefing
type: feature
---

# VerwaltungsOS DailyBrief v1 — FROZEN 2026-05-27

Lebende Verwaltungsintelligenz über Fachbereichs-DNA v1 + Oral Bridge v1.
Keine neuen Tabellen, keine Mutationen, keine generativen Empfehlungen.

## Architektur

- **View** `v_verwaltung_daily_brief_signals` — per-Fachbereich Aggregation
  (sessions 24h/7d/30d, avg/max escalation, high_conflict_pct, score-Durchschnitte
  pro Dimension, top_emotions, top_personas). REVOKE PUBLIC/anon/authenticated,
  GRANT service_role.
- **RPCs** (SECURITY DEFINER, `has_role(uid,'admin')`-gated):
  - `verwaltung_daily_brief_department(_department_key, _window_days)` →
    Fachbereichs-Briefing inkl. weakest_dimension + deterministischer Recommendation
  - `verwaltung_daily_brief_executive(_window_days)` → totals + KGSt-Cluster-Heat + Hotspots (Top 8)
  - `verwaltung_daily_brief_governance_risks(_window_days)` → klassifizierte Risiken
    (ESKALATIONS_CLUSTER · BUERGERFRUST_RISIKO · GOVERNANCE_LUECKE · DEESKALATIONS_DEFIZIT ·
     EMPATHIE_DEFIZIT · KOMMUNIKATIONS_DRIFT)
- **UI** `/admin/verwaltung/daily-brief` — Window-Switch 24h/7d/30d, 4 KPI-Tiles,
  Cluster-Heat, Risk-Grid, Fachbereichs-Drilldown mit Scorecard + Recommendation.
- **Reader-Lib** `src/lib/berufs-ki/occupational-intelligence.ts` — drei typed Getter.

## Smoke (GREEN 2026-05-27)

`scripts/verwaltung-daily-brief-smoke.mjs`:
- anon blockiert (401) auf allen drei RPCs
- service-role erreicht alle Endpunkte (Body = forbidden, weil kein auth.uid() — Gate-by-Design)

## Anti-Drift (hard rules)

- DailyBrief liest ausschließlich aus `verwaltung_oral_sessions`/`verwaltung_oral_turns`
  und `verwaltung_department_dna`. Keine eigenen Schreibpfade.
- Recommendations sind im RPC deterministisch abgeleitet — kein LLM-Call.
- `sysop` existiert nicht als app_role; Gate prüft nur `admin`.
- Erweiterungen (neue Risk-Typen / neue Briefing-Sichten) erfordern Migration +
  Reader-Lib + Smoke-Update.
- Keine Mirror-Tabellen / Caches — Aggregation läuft live über View.
