---
name: Semantic Knowledge Graph Foundation v1 (Phase P1)
description: SSOT src/lib/semantic — deterministic Pillar/SRO/SEO/LLM foundation. 10 entity kinds, 11 edge kinds, 8 pillar kinds, 5 resolvers, golden tests, CI guard. Examiner-isolation enforced.
type: feature
---

## Scope
Phase P1 of the Pillar/SRO/SEO Authority Rollout. Pure TS, no DB migration.
Reads will be wired in P2+ via Supabase views.

## SSOT
- `src/lib/semantic/types.ts` — 10 EntityKinds (`beruf | pruefung | lernfeld | kompetenz | risiko | fehlerbild | pruefungsform | pruefungsstrategie | oral_pattern | industry_context`), 11 EdgeKinds.
- `src/lib/semantic/KnowledgeGraph.ts` — deterministic in-memory graph (stable insert/sort, dedup by `(kind,from,to)`).
- `src/lib/semantic/resolvers.ts` — `relatedCompetencies`, `relatedRisks`, `relatedMistakes`, `relatedOralPatterns`, `relatedExamScenarios`.
- `src/lib/semantic/PillarTypes.ts` — 8 PillarKinds + `PILLAR_ANCHOR` + `ENTITY_TO_PILLARS`.
- `src/lib/semantic/index.ts` — barrel; surfaces import from `@/lib/semantic` only.

## Hard rules
- Semantic / pillar / llm-grounding layers MUST NOT compute readiness, confidence, verdicts, or alternative risk severity. Examiner facts come from `@/lib/examiner` Handover Contract (frozen v1).
- Edges are content-addressable `(kind,from,to)`; deterministic order; dedup on build.
- `Risiko.examiner_severity` mirrors Handover Contract — never derived locally.

## Tests + Guards
- `src/__tests__/semantic-graph.golden.test.ts` — determinism, dedup, resolver sort, examiner-isolation (file scan).
- `scripts/guards/semantic-no-examiner-bypass.mjs` + `.github/workflows/semantic-no-examiner-bypass.yml` — static scan blocks forbidden tokens (`readiness_state=`, `computeReadiness|Confidence|Verdict`, score threshold checks, examiner mutators) in semantic/llm-grounding/pillar dirs.

## Next (P2)
`src/lib/llm-grounding/` — stable serializers (`examinerEvidenceForLLM`, `competencySummary`, `riskExplanation`, `readinessExplanation`, `misconceptionSummary`) + SSOT-only FAQ generator. Wires P1 graph + Examiner Handover into chunkable AI-readable output.
