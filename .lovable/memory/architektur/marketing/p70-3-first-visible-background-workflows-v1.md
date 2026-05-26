---
name: P70.3 First Visible Background Workflows
description: Pure resolver/normalizer-Layer auf P70.1-View. Klassifiziert Tasks in 3 produktnahe Work Units (SEO Opportunity, Compliance Drift, Operational Quality). Cockpit-Workflows-Tab mit kundennahen Outcome-Labels. Curriculum-Repair-Sprache nie external. Re-Use P70.2-Dispatch. Keine DB-Änderung.
type: feature
---

# P70.3 — First Visible Background Workflows

**Continuity-Guard**: SSOT_FIRST · EXTEND_EXISTING · NO_PARALLEL_SYSTEMS · BRIDGE_DONT_FORK · NO_HIDDEN_STATE · NO_AUTONOMOUS_PRODUCTION_WRITES — alle erfüllt. Reine Normalizer-Schicht, keine Migration, keine neue Tabelle, kein neuer Dispatcher.

## Was gebaut wurde
- **Pure Classifier** `src/lib/governance/backgroundAgentWorkUnits.ts`
  - `classifyWorkUnit(task)` → `seo_opportunity | compliance_drift | operational_quality | other`
  - Regex-Heuristik auf `capability_summary + task_kind + meta`
  - `heal_permanent_fix_tasks` → immer `operational_quality`
  - Reihenfolge: compliance > seo > quality > other
- **Work-Unit-Registry** mit kundennaher Sprache pro Outcome:
  - `seo_opportunity` → "SEO Opportunities finden" (customer_visible)
  - `compliance_drift` → "Compliance Drift prüfen" (customer_visible)
  - `operational_quality` → intern "Produktqualität prüfen" / extern **"Kontinuierliche Qualitätsoptimierung"** (internal_only_quality)
  - Curriculum-Repair-Begriff in keiner externalLabel zulässig (CI-getestet)
- **Aggregation** `groupTasksByWorkUnit<T>(tasks)` — generisch, behält source_type+source_id für Traceability bei
- **Cockpit-Workflows-Tab** in `BackgroundAgentRuntimePage.tsx`:
  - Default-Tab statt "Quellen"
  - 3 Outcome-Cards mit Total/Aktiv/Approval/Failed-KPIs + Artefakt-Count + High-Risk-Marker
  - Letzte 5 Einheiten je Outcome inkl. ersten 2 Actions aus P70.2-Resolver
  - "intern"-Badge + Kunden-Sicht-Synonym-Hinweis für `operational_quality`

## Invarianten
1. Resolver enthält keine `supabase.from` / `supabase.rpc` (pure Funktion).
2. P70.3-tagged Migrationen erstellen **keine** neuen Tabellen/Queues — es gibt schlicht keine P70.3-Migration.
3. Cockpit nutzt **denselben** `dispatchBackgroundAgentAction` aus P70.2 — kein paralleler Dispatcher.
4. Customer-facing Strings entstehen ausschließlich aus `WORK_UNIT_REGISTRY` (Single Source of Wording).
5. "other"-Tasks bleiben im klassischen Tasks-Tab sichtbar, nicht im Workflows-Tab (keine Verheimlichung, nur Fokussierung).

## Tests
`src/test/contracts/background-agent-work-units-contract.test.ts` — 24 grüne Tests:
- Registry-Shape (3 visible outcomes, Pflichtfelder)
- Curriculum-Repair-Sprache nie external
- 12 Klassifikator-Tabellen-Tests (SEO/Compliance/Quality/Other)
- Traceability source_type+source_id nach Grouping
- "other" wird aus Workflows gefiltert
- Aggregation Status/Approval/Risk/Artefakte
- Pure-Layer-Guard (kein from/rpc im Resolver)
- Migrationen mit P70.3-Tag erstellen keine Tabellen
- Cockpit konsumiert Registry + `dispatchBackgroundAgentAction` + `internal_only_quality`-Marker

Kombiniert mit P70.1+P70.2: **51/51 grün**.

## Nächster Cut
**P70.4 — Scheduled/Triggered Background Work**: Auslöser + Zeitplan für die drei Outcome-Workflows sichtbar machen, ausschließlich über bestehende `system_intents` + `pg_cron`-Schedules + `system-intent-worker`. Erst sinnvoll, wenn das Cockpit live mit echten Tasks demo-tauglich aussieht.
