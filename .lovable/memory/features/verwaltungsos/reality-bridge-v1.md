---
name: VerwaltungsOS Reality-Bridge v1
description: Read-only Verkabelung Fachbereichs-DNA × Oral-Eskalation × BA-Arbeitsmarkt. Server-RPC + DailyBrief-Panel + Live-Mini-Karte pro Fachbereich.
type: feature
---

# VerwaltungsOS Reality-Bridge v1 — FROZEN 2026-05-28

Schließt L1/L2/L4 aus dem Audit vom 2026-05-28: DNA, Oral-Signale und Arbeitsmarkt waren disjunkt — sind jetzt korreliert.

## Architektur (kein neues Schreibsystem)

- **Helper** `public.fn_verwaltung_market_query(_department_key)` — STABLE SECURITY DEFINER. Kanonische BA-Jobsuche-Query = erstes Segment vor `/` oder `(` aus `department_name`. UI-Parität in `VerwaltungDepartmentsSection.DepartmentLiveMarketCard`.
- **RPC** `public.verwaltung_daily_brief_reality_bridge(_window_days, _limit)` — admin-gated (`has_role`). Join über `v_verwaltung_daily_brief_signals` + `verwaltung_department_dna`. Liefert pro Fachbereich `{market_query, oral_sessions, avg_escalation, high_conflict_pct, reality_priority HIGH|MEDIUM|LOW|IDLE}`. Kein Bund-API-Call in DB.
- **Reader-Lib** `src/lib/berufs-ki/occupational-intelligence.ts`: `VRealityBridge`, `VRealityDepartment`, `VRealityJobsSummary`, `getVerwaltungDailyBriefRealityBridge`, `getVerwaltungLiveJobsForQuery` (Pass-Through zu Edge `verwaltung-arbeitsmarkt`).
- **UI A** `VerwaltungDepartmentsSection`: Mini-Card `DepartmentLiveMarketCard` im Detail-Panel auf `/branchen/verwaltung` — KPIs (Total / 7d / 14d / 30d), Top-Arbeitgeber, Top-Orte, Deep-Link zu arbeitsagentur.de.
- **UI B** `VerwaltungDailyBriefPage`: neue Sektion `RealityBridgeSection` auf `/admin/verwaltung/daily-brief` — Top 6 HIGH/MEDIUM-Departments mit paralleler Live-Marktabfrage.

## Audit-Befund (in v1 dokumentiert)

`verwaltung_department_dna.{roles,processes,kpis,risks,...}` sind aktuell **leere Arrays** (nur `use_cases` + `oral_training_cases` befüllt). Reality-Bridge baut deshalb ausschließlich auf `department_name` + `category` — kein Phantom-Mapping. Daten-Hole für DNA-Layer-Befüllung in Nachfolge-Cut adressieren.

## Anti-Drift

1. Keine Bund-API-Aufrufe in der DB — RPC liefert nur die kanonische Query; Edge bleibt einziger HTTP-Pfad.
2. Keine Persistenz von BA-Daten — Pass-Through, 5-Min-Worker-Cache in Edge.
3. Keine LLM-Bewertung der Korrelation — `reality_priority` ist deterministische Stufenfunktion über `avg_escalation`/`sessions`.
4. `fn_verwaltung_market_query`-Heuristik in UI gespiegelt (split `/` / `(` / trim) — Drift verboten.

## Offen (nicht in v1)

- Geo-Bridge (ARS) zwischen `verwaltung_oral_sessions` und NINA/Pegel — braucht ARS auf Session-Ebene.
- BERUFENET-Steckbriefe pro Fachbereich.
- DNA-Layer-Backfill (`roles`/`processes`/`kpis`).
- Zweite Vertikale auf gleichem Pattern (HandwerkOS/ImmobilienOS) erst nach DNA-Backfill.
