---
name: VerwaltungsOS Arbeitsmarkt-Lagebild v1
description: Read-only Bridge zur öffentlichen Jobsuche-API der Bundesagentur für Arbeit (bund.dev). Echtzeit-Stellen + Aggregationen (Top-Arbeitgeber, Top-Orte, Trend) ohne eigene Bewertung.
type: feature
---

# Scope

Berufs-zentriertes Marktdaten-Lagebild für VerwaltungsOS auf Basis offizieller, keyless Bund-APIs.

## Komponenten

- **Edge Function** `supabase/functions/verwaltung-arbeitsmarkt/index.ts`
  - Quelle: `https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobs`
  - Header: `X-API-Key: jobboerse-jobsuche` (öffentlich, dokumentiert auf bund.dev)
  - Input: `{ was, wo?, umkreis?, size?, page?, angebotsart? }` — `was` Pflicht (min 2 Zeichen → 400).
  - Output: `{ jobs[], aggregation{ total, top_arbeitgeber, top_orte, trend{7/14/30d} }, source, fetched_at, errors[] }`
  - In-Memory-Cache 5 Min pro Query-Key.
  - `verify_jwt = false` (public data), CORS offen.

- **UI** `src/components/verticals/VerwaltungArbeitsmarktSection.tsx`
  - Eingebettet in `/branchen/verwaltung` (oberhalb des Bund-Lagebilds).
  - Preset-Berufe (Verwaltungsfachangestellte, Verwaltungsfachwirt, Bauamt, Sozialamt, …) + Freitext + Ort/Umkreis.
  - KPI-Tiles (Treffer gesamt, Neu 7/14/30 Tage), Top-Arbeitgeber, Top-Standorte, sortierte Job-Liste.
  - Job-Links öffnen offizielles Detail auf arbeitsagentur.de.

- **Smoke** `scripts/verwaltung-arbeitsmarkt-smoke.mjs`
  - Validiert: 400 ohne `was`, 200 mit Verwaltungs-Beruf, 200 mit Ort+Umkreis, Pflichtfelder (jobs[], aggregation, source).

## Anti-Drift-Regeln

1. **Pass-Through**: Keine eigene Bewertung, kein LLM-Pfad, keine Persistenz.
2. **Quelle sichtbar**: Jedes Item trägt `source: "BA_JOBSUCHE"`, UI zeigt Quelle + Stand explizit.
3. **Kein Schreibpfad**: Edge-Function ist GET/POST read-only; keine DB-Mutation.
4. **Cache-TTL**: 5 Min pro Query-Key, Worker-lokal — kein zentraler Cache, keine Stale-Reads in DB.

## Erweiterungs-Hooks (out of scope v1)

- BERUFENET-Steckbriefe (Beruf → Tätigkeiten/Anforderungen) als zweiter Bund-Endpoint.
- Arbeitsmarkt-Statistik (regionale Arbeitslosen-/Vakanz-Quoten) für Executive-Lagebild.
- Bridge zu VerwaltungsOS Fachbereichs-DNA: pro Fachbereich Default-Berufe + automatische Lagebild-Karte.
- DailyBrief-Integration: signifikante 7d-Trends als Governance-Signal.
