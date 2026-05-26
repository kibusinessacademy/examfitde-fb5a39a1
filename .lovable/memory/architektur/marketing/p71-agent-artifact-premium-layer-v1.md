---
name: P71 Agent Artifact Premium Layer
description: Pure resolver + ArtifactPreviewDrawer auf P70.1-View. 7 Artifact-Typen (report/checklist/finding/diff_plan/seo_brief/compliance_evidence/quality_plan), Evidence Chain (source→action→artifact→audit), Export/Copy als JSON+Markdown, Empty States. Keine DB, keine RPC, keine Mutation.
type: feature
---

# P71 — Agent Artifact Premium Layer

**Continuity-Guard**: SSOT_FIRST · EXTEND_EXISTING · NO_PARALLEL_SYSTEMS · NO_HIDDEN_STATE · NO_AUTONOMOUS_PRODUCTION_WRITES — alle erfüllt.

## Was gebaut wurde
- **Pure Resolver** `src/lib/governance/backgroundAgentArtifacts.ts`
  - `ARTIFACT_REGISTRY` mit 7 customer-facing Typen + `unknown`-Fallback
  - `classifyArtifact(task)` — Reihenfolge: compliance > seo > quality > checklist > diff > finding > report-fallback > unknown; meta.artifact_type-Hint überschreibt
  - `buildArtifactPreview(task)` — alphabetisch stabile Sections aus meta, redact für `token|secret|api_key|password|cookie|bearer`
  - `buildEvidenceChain(task)` — immer 4 Schritte: source → action → artifact → audit
  - `exportArtifactAsJson` / `exportArtifactAsMarkdown` — pure projections
- **Drawer** `src/components/governance/ArtifactPreviewDrawer.tsx` (Sheet-basiert)
  - Header mit Typ-Badge, Title, Summary
  - Export-Bar (Copy MD/JSON + Download .md/.json)
  - Empty-State "Workflow gestartet, Ergebnis erscheint nach Abschluss" mit Inbox-Icon
  - Evidence-Chain mit kind-getönten Badges
- **Cockpit-Wiring** `BackgroundAgentRuntimePage.tsx`
  - `open_artifacts`-Action öffnet Drawer (statt externer Nav)
  - Workflow-Cards: "Vorschau"-Button auf jeder Sample-Row, Empty-State pro Workflow-Card
  - Tasks-Tabelle: artifact_count-Zahl klickbar → öffnet Drawer

## Invarianten
1. Resolver enthält keine `supabase.from` / `supabase.rpc` / `fetch` / `Date.now` / `Math.random`.
2. Drawer enthält keine direkten Table-Reads/RPCs — verbraucht ausschließlich vorgelade­ne TaskRows aus P70.1 RPCs.
3. Keine Migration unter P71-Tag erlaubt; statisch geprüft.
4. Customer-Labels enthalten nie "curriculum repair" oder "council".
5. Evidence-Chain hat genau 4 Steps in fester Reihenfolge.

## Tests
`src/test/contracts/background-agent-artifacts-contract.test.ts` — 25 grüne Tests (Registry, Classifier-Tabelle, Preview-Projection inkl. Redact, Evidence-Chain Shape, Export JSON/MD, Purity-Guards).

Kombiniert P70.1+P70.2+P70.3+P70.4+P71: **92/92 grün**.

## Nächster Cut
**P72 — Scheduled Agent Runs**: read-only Aggregation aus `cron.job` + `system_intents` zeigt welcher Workflow durch welchen bestehenden Cron/Intent regelmäßig getriggert wird. Keine neue Scheduler-Schicht.

## Files
- `src/lib/governance/backgroundAgentArtifacts.ts` (neu)
- `src/components/governance/ArtifactPreviewDrawer.tsx` (neu)
- `src/test/contracts/background-agent-artifacts-contract.test.ts` (neu, 25 Tests)
- `src/pages/admin/governance/BackgroundAgentRuntimePage.tsx` (Drawer-Wiring, Empty-States, Preview-Triggers)
