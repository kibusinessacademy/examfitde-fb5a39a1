---
name: VerwaltungsOS DNA Backfill v1 (roles/processes/kpis/risks)
description: Deterministischer Per-Fachbereich-Backfill der 4 leeren DNA-Layer. 40/40 Coverage mit ≥3 roles/≥4 processes/≥3 kpis/≥3 risks. Idempotent.
type: feature
---

# VerwaltungsOS DNA Backfill v1 — FROZEN 2026-05-28

Schließt die im Reality-Bridge-Audit dokumentierte Daten-Hole:
`verwaltung_department_dna.{roles, processes, kpis, risks}` waren leere Arrays
in allen 40 Fachbereichen. Reality-Bridge konnte nur auf `department_name` +
`category` joinen.

## Was gemacht wurde

- **Per-Fachbereich-Mapping** (40/40) mit kuratierten Inhalten:
  - ≥3 Rollen (mit Beschreibung), ≥4 Prozesse (mit Verweisen auf relevante
    Rechtsgrundlagen: BauGB, GewO, SGB VIII/XII, WaffG, AsylbLG, DSGVO, GO, …),
    ≥3 KPIs (mit Steuerungskontext), ≥3 Risiken (mit Wirkungseinschätzung).
- **Idempotent**: Update überschreibt nur, wenn Feld leer/null
  (`COALESCE(jsonb_array_length, 0) = 0`).
- **Single UPDATE**, kein neues Schema, kein Schreibsystem.

## Verifikation

- `scripts/verwaltung-dna-layers-smoke.mjs` (anon, GREEN 2026-05-28):
  40/40 Fachbereiche tragen alle 4 Layer mit Mindestabdeckung (3/4/3/3).
- `scripts/verwaltung-fachbereichs-dna-smoke.mjs` weiterhin GREEN.

## Anti-Drift

1. Inhalte sind kuratierte Verwaltungsrealität (KGSt-Cluster-konsistent), keine
   LLM-Generierung — Trust-Schicht der Plattform.
2. Reality-Bridge bleibt SSOT für Korrelation — DNA-Layer ändern keine Logik,
   sondern nur Anzeige + zukünftige Reichweite der Bridge.
3. Weitere Inhalte (z. B. Persona-Vertiefungen, regionale Spezifika) erfordern
   neuen Cut + Smoke-Mindestwerte hochziehen.

## Folgewirkung (ohne Code-Änderung)

- `VerwaltungDepartmentsSection` (Public) zeigt jetzt befüllte Prozesse/KPIs/
  Risiken/Rollen im Detail-Panel.
- Executive Cockpit + DailyBrief erben die Daten via existierende RPCs.
- Reality-Bridge kann in Nachfolge-Cut auf `processes`/`kpis` joinen (z. B.
  KPI-Trigger ↔ Oral-Eskalation).
