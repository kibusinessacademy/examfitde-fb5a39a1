---
name: VerwaltungsOS Fachbereichs-DNA v1
description: 40 KGSt-clusterte kommunale Fachbereiche mit strukturierter Berufsintelligenz (Prozesse, KPIs, Risiken, Dokumente, Kommunikations-/Entscheidungsmuster, Eskalationspfade, Use-Cases, Oral-Training-Szenarien). Read-only Bridge — keine Generierung, kein Shadow-State.
type: feature
---

# VerwaltungsOS Fachbereichs-DNA v1 — FROZEN 2026-05-27

## Was existiert (SSOT)
- **Tabelle** `public.verwaltung_department_dna` — 40 Rows, 11 JSONB-Layer pro Fachbereich:
  - `roles`, `processes`, `documents`, `kpis`, `risks`
  - `communication_patterns`, `decision_models`, `escalation_paths`
  - `persona_seeds`, `use_cases`, `oral_training_cases`
- **RPCs** (read-only, anon-safe):
  - `list_verwaltung_departments()` → `{department_key, department_name, category, use_cases_count, oral_cases_count}[]`
  - `get_verwaltung_department_dna(_department_key text)` → vollständige Row als JSONB
- **Reader-Lib** `src/lib/berufs-ki/occupational-intelligence.ts`:
  - `VerwaltungDepartmentSummary`, `VerwaltungDepartmentDna`, `VDNamedItem`, `VDUseCase`, `VDOralCase`
  - `listVerwaltungDepartments()`, `getVerwaltungDepartmentDna(key)`
- **UI** `src/components/verticals/VerwaltungDepartmentsSection.tsx`, gemountet in `VerticalDetailPage` **nur** für `slug === "verwaltung"`. KGSt-Cluster-Liste links, Detail-Panel rechts (Prozesse / KPIs / Risiken / Dokumente / Kommunikation / Eskalation / Entscheidung / Rollen + Use-Cases + Oral-Trainer-Bridge mit Konflikt-Level).
- **Smoke** `scripts/verwaltung-fachbereichs-dna-smoke.mjs` (5 Checks, anon-Key, GREEN 2026-05-27: 40 Fachbereiche, 400 Use-Cases, 120 Oral-Szenarien, 8 KGSt-Cluster).

## KGSt-Cluster (Coverage)
Service · Soziales/Jugend · Soziales/Bürger · Schule/Kultur · Bauen/Umwelt · Wirtschaft · Sicherheit/Ordnung · Steuerung/Service

## Verbote (Anti-Drift)
- **Keine** generative AI auf dieser DNA — read-only Bridge.
- **Keine** parallele Department-Tabelle / kein Shadow-State.
- **Keine** Erweiterung der Layer ohne Migration + Reader-Lib-Update + Smoke-Anpassung.
- Oral-Training **direkt** in der Fachbereichs-DNA (nicht separat) — Trust-Effekt.

## Strategischer Claim (verkaufsfähig)
> "VerwaltungsOS basiert auf strukturierter Fachbereichs-Intelligenz statt generischem KI-Chat."

40 Ämter × 11 strukturierte Layer × 400 Use-Cases × 120 Oral-Szenarien = **Occupational Governance Infrastructure**.

## Nächste Schritte (nicht in v1)
- Oral-Trainer-Bridge → tatsächlicher Trainer-Flow (Persona-Simulation Cut)
- DailyBrief pro Fachbereich (KPI-Modelle als Trigger)
- Executive-View: Cluster-aggregierte Outcome-Indikatoren
- Vertikalisierung weiterer öffentlicher Träger (Bund/Länder/Kreise)
