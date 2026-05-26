---
name: FördermittelOS Cut 3 — Execution OS
description: Application Readiness, Document Check, Checklist, Timeline (8 Phasen), Risk Ranking, Next Best Actions, Cross-OS Bridge Events. Deterministisch, ohne AI/Crawler.
type: feature
---

# FördermittelOS Cut 3 — Execution OS

## Scope
Aus „passende Förderung finden" wird **konkreter Umsetzungsfahrplan**.
Erweitert Cut 1 (Registry+Matching) und Cut 2 (Freshness) — **keine** parallele Engine, **keine** Mock-AI, **keine** Uploads/Crawler.

## SSOT
`src/lib/foerdermittel/execution.ts` — Pure Functions:
- `buildDocumentChecklist(program, presentKeys)` → `DocumentCheckItem[]` (status: present|missing|optional|critical|unclear)
- `classifyMissingDocuments(program, presentKeys)` → `{ missingCritical, missingOptional, present }`
- `toDocKey(label)` → stabiler slug-safer Key (NFD + lowercase)
- `buildApplicationChecklist(program, presentDocs, metReqs)` → requirements + docs kombiniert
- `rankApplicationRisks(program, profile?, presentDocs, metReqs, now)` → 7 Risk-Klassen, severity-sortiert
- `computeApplicationReadiness(...)` → `{ score 0..100, verdict ready|almost|gaps|blocked, breakdown{documents,requirements,timing,sourceFreshness}, missingCriticalDocs, missingOptionalDocs, unmetHardRequirements }`. Gewichtung 35/35/20/10.
- `buildApplicationTimeline(program)` → 8 kanonische Phasen: pruefung → unterlagen → projektbeschreibung → kostenplan → antrag → rueckfragen → bewilligung → nachweise. estimateWeeks aus `decisionWeeks`.
- `buildNextBestActions(program, readiness, presentDocs)` → priorisierte Aktionen (now|soon|later) mit optionalem Bridge-Event
- `buildBridgeEvents(program, readiness)` → strukturierte Cross-OS-Events

## Cross-OS Bridges (Contract-Vorbereitung)
Bridge-Targets als Typunion: `FristenOS | VertragscheckerOS | AngebotsvergleichOS | ComplianceOS | WissensOS`.
Events sind reine Daten (`{os, intent, payload}`) — **keine** echten Integrationen erzwungen.
Beispiele:
- `FristenOS::create_deadline` bei Frist ≤ 30 Tagen
- `WissensOS::open_program_kit` für Dokumente
- `ComplianceOS::verify_eligibility` bei readiness ≠ ready
- `AngebotsvergleichOS` in Timeline-Step „Kostenplan"
- `VertragscheckerOS` in Timeline-Step „Bewilligung"

## UI
- `src/components/foerdermittel/ApplicationRoadmapCard.tsx` — Premium-Block auf Detailseite (Readiness-Ring, Breakdown 4-Spalten, Next Best Actions, interaktive Doc/Req-Checklisten, Risk-Grid, vertikale Timeline mit Bridge-Badges). Disclaimer Pflicht.
- `src/components/foerdermittel/NextStepsPreview.tsx` — Hub-Preview für Top-3-Matches mit Readiness-Score + 2 NBAs pro Karte.
- `FoerdermittelProgramPage` ergänzt `<ApplicationRoadmapCard program={program} />` nach Quellen-Block.
- `FoerdermittelHubPage` rendert `<NextStepsPreview matches={grouped.excellent} />` über den Match-Grids.

## SEO
- Hub-Title/Description erweitert um „Förderantrag vorbereiten", „Fördermittel Unterlagen", „Antragscheckliste".
- Programm-Detail-Title erweitert um „Antrag, Unterlagen, Fristen". Description nimmt program.shortDescription + Antragsfahrplan-Hinweis.

## Tests
`src/test/foerdermittel/execution.test.ts` — **15 Tests grün**:
- Document Check: critical-Flag, present-Marker, toDocKey-Stability
- Readiness: blocked bei 0/0, ready bei vollständig, breakdown 0..100-bound
- Checklist: requirements+docs vereint, korrekte Count
- Risk Ranking: hard-requirements+critical-documents auto-surface, Severity-Order, Clearing bei satisfied
- Next Best Actions: now-Priority bei lower readiness, Bridge-Events angehängt
- Timeline: 8 kanonische Phasen-Keys in Reihenfolge
- Bridge Events: strukturierte Emissions
- Cut 1/2 Regression: Registry + freshness weiter importierbar

Gesamtsuite FördermittelOS: **29/29 grün** (14 freshness + 15 execution).

## Akzeptanz erfüllt
- Nutzer sieht nach Match konkreten Antragspfad (Readiness, Checklist, Risks, Timeline, NBAs).
- Cut 1/2 vollständig erhalten, keine Rückbauten, keine parallele Logik.
- Deterministisch, client-safe, keine Mock-AI, keine Crawler.
- Premium UX (Readiness-Ring, Bridge-Badges, Premium-Card im Detail).
- Bridge-Events als saubere Verträge für FristenOS/VertragscheckerOS/AngebotsvergleichOS/ComplianceOS/WissensOS vorbereitet — ohne erzwungene Integration.

## Next
- Cut 4: AI CoPilot über Lovable AI Gateway (Edge Function `foerdermittel-copilot`, kein Client-Call). Input: Programm + Profil + Readiness; Output: Anschreiben-Entwurf, Kombi-Analyse, „Wie beantworte ich Rückfragen?".
- Cut 5: SEO Authority Engine — Bundesland-/Themen-/Branchen-Cluster (programmatic).
