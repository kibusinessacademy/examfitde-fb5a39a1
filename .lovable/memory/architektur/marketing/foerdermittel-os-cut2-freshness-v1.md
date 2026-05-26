---
name: FördermittelOS Cut 2 — Freshness Governance
description: Freshness/ChangeRisk SSOT, FörderRadar UI, Matching-Penalty bei stale/unknown, deterministisch ohne AI/Crawler
type: feature
---

# FördermittelOS Cut 2 — Change-Detection + Freshness Governance

## Scope
Erweitert Cut 1 (Registry + Matching) um Aktualitäts- und Änderungsrisiko-Logik.
**Keine** Mock-AI, **keine** Live-Crawler, **keine** parallele Registry/Matching-Engine.

## SSOT
- `src/lib/foerdermittel/types.ts` — `ProgramFreshness`, `FreshnessStatus`, `ChangeRisk`, `UpdateCadence` (alle additive Felder, back-compat)
- `src/lib/foerdermittel/freshness.ts` — Pure Functions:
  - `classifyFreshness(p, now)` → fresh|watch|stale|unknown (cadence-aware, nextReviewAt-overdue)
  - `classifyChangeRisk(p, now)` → low|medium|high (status, budgetTension, deadline, cadence, regional)
  - `needsReview(p, now)`
  - `summarizeProgramFreshness(programs)`
  - `rankProgramsByReviewUrgency(programs)` — urgency 0..100 mit Reason
  - `explainFreshness(p, now)` — Detail-Explainability-Lines

## UI
- `src/components/foerdermittel/FoerderRadarCard.tsx` — Hub-Top-Card (KPIs fresh/watch/stale/unknown + Top-5 Prüfbedarf)
- `src/components/foerdermittel/FreshnessBadge.tsx` — Wiederverwendbar (ProgramCard, Detail)
- `ProgramCard` zeigt Freshness-Badge in Topic-Row
- `FoerdermittelProgramPage` zeigt eigenen „Aktualität & Änderungsrisiko"-Block mit explainFreshness + lastVerifiedAt/nextReviewAt/Cadence-Tiles

## Matching-Integration
`scoreMatch()` in `matching.ts`:
- `stale` → Fit × 0.9 + Warnung „vor Antrag prüfen"
- `unknown` → Fit × 0.93 + Warnung „Fit gut, aber prüfen"
- `watch` → nur Warnung, kein Score-Eingriff
- **Niemals disqualifizierend**

## Seed-Backfill
Alle 12 Programme in `registry.ts` haben `freshness` (sourceName, lastVerifiedAt, nextReviewAt, updateCadence, optional verificationNotes/officialSourceRequired). Backfill via `/tmp/patch-registry.mjs` (einmaliges Script, nicht im Repo).

## SEO
- Hub-Title/Description erweitert um „FörderRadar", „aktuelle Förderprogramme", „Fördermittel Änderungen", „Fristen"
- Keine programmatic Massenseiten in diesem Cut

## Tests
`src/test/foerdermittel/freshness.test.ts` — 14 Tests grün:
- Freshness-Klassifikation (5 Fälle inkl. overdue-nextReview)
- ChangeRisk-Klassifikation (3 Fälle)
- needsReview (2 Fälle)
- rankProgramsByReviewUrgency (Reihenfolge stale>fresh)
- Seed-Registry-Summary-Konsistenz
- Matching-Penalty stale/unknown (Fit reduziert, Warnung gesetzt, keine Disqualifikation)

## Akzeptanz erfüllt
- Cut 1 bleibt vollständig erhalten (Registry/Matching/Routes unverändert in Signatur)
- FörderRadar live auf `/foerdermittel`
- Detail zeigt Aktualität, Quellenlogik, Explainability
- Matching erklärt Freshness-Risiken
- Keine Mock-AI, keine externen Live-Crawler
- 14/14 Tests grün

## Next
- Cut 3: Execution OS (Fristen-Pipeline, Aufgaben, Dokumentencheck)
- Cut 4: AI CoPilot über Lovable AI Gateway (Edge Function, kein Client-Call)
- Cut 5: SEO Authority Engine (Bundesland-/Themen-/Branchen-Cluster)
