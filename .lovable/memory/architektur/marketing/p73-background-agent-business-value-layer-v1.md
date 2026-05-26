---
name: P73 Background Agent Business Value Layer
description: Pure resolver `backgroundAgentValue.ts` + ValueLayerSection-Tab. Macht aus P70.1-Tasks + P71-Artifact-Klassifikation customer-facing Value Cards (Chancen/Risiken/Reports/Prüfungen/Zeitersparnis), Latest-Outcome-Summary und Workflow-Health (running|stale|failed|no_artifacts_yet|healthy). Keine neue Runtime, keine neue Queue, keine neue RPC, keine Migration.
type: feature
---

# P73 — Background Agent Business Value Layer

**Continuity-Guard**: SSOT_FIRST · EXTEND_EXISTING · NO_PARALLEL_SYSTEMS · NO_HIDDEN_STATE · GOVERNANCE_BEFORE_AUTOMATION · NO_AUTONOMOUS_PRODUCTION_WRITES — alle erfüllt.

## Was gebaut wurde
- **Pure Resolver** `src/lib/governance/backgroundAgentValue.ts`
  - `buildWorkflowValueCards(tasks, { nowIso })` → genau 3 customer-facing Cards in fester Reihenfolge (seo_opportunity, compliance_drift, operational_quality)
  - Value-Mapping pro Artifact-Typ deterministisch:
    - seo_brief → +1 opp, +1 report, **90 Min**
    - compliance_evidence → +1 risk, +1 report, +1 check, **120 Min**
    - quality_plan → +1 report, +1 check, **45 Min**
    - diff_plan → +1 report, **30 Min**
    - report/checklist/finding → 30/15/10 Min
  - `WorkflowHealth`: running > failed-only > no_artifacts_yet > stale (24h) > healthy
  - `pickLatest` deterministisch (last_event_at desc, source_id tiebreak)
  - `formatMinutesSaved` reine Projektion
  - `isStale(lastEventAt, nowIso, hours)` — Pure, nowIso vom Caller
- **Cockpit-Tab "Wirkung"** (Default-Tab) in `BackgroundAgentRuntimePage.tsx`
  - 4 Top-KPIs (SEO-Chancen, Risiken vermieden, Reports, Zeitersparnis)
  - 3 Value Cards mit Health-Badge, Metriken-Grid, Zeitersparnis, Latest-Outcome
  - Latest-Outcome triggert P71 `ArtifactPreviewDrawer`
  - Empty-State: „Workflow gestartet — Ergebnis erscheint nach Abschluss."

## Customer-Safe Copy
- „SEO-Chancen automatisch gesammelt"
- „Compliance-Risiken frühzeitig erkannt"
- „KI erledigt wiederkehrende Prüfungen"
- Healthlines: „läuft / läuft gerade / pausiert / gestört / wartet auf Ergebnis"

## Invarianten (CI-getestet, 16 Tests grün)
1. Resolver pure (kein supabase/fetch/Date.now/Math.random/new Date())
2. Empty-State liefert 3 Cards mit 0-Metriken + no_artifacts_yet
3. Health-Verdict deterministisch (running dominiert über failed)
4. Stale-Schwelle 24h, caller-supplied nowIso
5. Latest-Outcome stabil sortiert
6. Customer-safe Copy enthält keine internen Begriffe (curriculum repair / council / drift-heal / bronze / phantom / blueprint / job_queue / system_intents)
7. Cockpit importiert nur Resolver, kein neuer RPC
8. Keine Migrations unter P73-Tag

## Bewusst NICHT gebaut
- Keine Outcome-Tabelle (BK-Outcome-Engine bleibt für berufs_ki_workflow_runs zuständig, nicht für Background-Tasks)
- Kein A/B von Value-Schätzungen (Konstanten sind verteidigbar genug)
- Kein Trend (7d/30d) — Daten dafür existieren in den Quellen, aber bewusst out-of-scope

## Files
- `src/lib/governance/backgroundAgentValue.ts` (neu)
- `src/test/contracts/background-agent-value-contract.test.ts` (neu, 16 Tests)
- `src/pages/admin/governance/BackgroundAgentRuntimePage.tsx` (Value-Tab als Default + `ValueLayerSection` Komponente)

## Nächster Cut
P74 nicht automatisch. Vorschlag: Distribution/Demo-Asset auf Basis P70–P73 (Vertriebsdemo "AI erledigt Hintergrundarbeit") — kein neuer Plattform-Tiefencut.
