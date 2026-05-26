---
name: Berufs-KI Demo-Flows v1 (Cut 2 Market Activation)
description: Sample-Cohorts, One-Click-Szenarien, Persona-Tours, AI-Narratives, Activation Journey unter /demo — Produkt in 60–120s fühlbar machen
type: feature
---

# Demo-Flows v1 — Cut 2 Market Activation

**Strategischer Kontext:** Nach Cut 1 (Packaging /suites) ist Cut 2 der entscheidende Conversion-Hebel. BerufsKI ist technisch tief — aber bisher nicht „sofort erlebbar". Demo-Flows lösen das.

## SSOT-Dateien (Code, KEINE DB)

- `src/lib/demo/cohorts.ts` — 4 Sample Cohorts (FISI Frühjahr 2026, Industriekaufleute AP2, AEVO Q2, Bilanzbuchhalter Intensiv) mit realistischen Risiken, Recovery-Lift, Hotspots, Interventionen, Outcome-Forecast.
- `src/lib/demo/scenarios.ts` — 6 One-Click-Szenarien (risk, recovery, exam_risk, compare, intervention, narrative).
- `src/lib/demo/tours.ts` — 5 Persona-Tours (Ausbildungsleiter, Azubi, Standortleiter, HR, Executive), je 3–5 Outcome-first-Schritte.
- `src/lib/demo/narratives.ts` — Deterministische Cohort-Narrative (kein AI-Call, pure Templating — entspricht ai_tutor-Citation-Discipline).

## Pages

- `/demo` — `DemoHubPage` (Szenarien, Tours, Sample-Cohorts).
- `/demo/cohort/:slug?view={risk|recovery|exam_risk|compare|intervention|narrative}` — `DemoCohortPage` mit View-Switch.
- `/demo/journey?stage={risk|cause|intervention|effect|outcome}` — `ActivationJourneyPage` (zentrale Produktstory in 5 Schritten).

## Verlinkung

- `BerufsKIHubPage` Primary-CTA → `/demo` (war /berufs-ki/app).
- `BerufOSFooter` „Produktlinien" ergänzt um `/suites` und `/demo`.
- Routes registriert in `src/routes/AppRoutes.tsx`.

## Governance

- Keine neue DB-Tabelle, keine Server-AI-Calls, keine Parallel-Edges zum SSOT.
- Narratives sind deterministisch — Tutor-Strict-RAG-Disziplin bleibt unverletzt.
- Cohort-Daten sind fiktiv aber realitätsnah; UI markiert sie als „Demo-Cohort".
- Activation-Kriterium erfüllt: stärkt Distribution + Conversion ohne neue Core-Architektur.

## Nächste Cuts (Reihenfolge bestätigt)

1. ✅ Cut 1 — Packaging (Suites)
2. ✅ Cut 2 — Demo-Flows (dieser Eintrag)
3. ⏭ Cut 3 — Distribution Engine (Berufsseiten, Kompetenzseiten, Outcome-Seiten)
4. ⏭ Cut 4 — Enterprise Sales Assets (ROI, PDF, Case Studies)
5. ⏭ Cut 5 — Workflow Marketplace (FISI-Pack, AEVO-Pack)
