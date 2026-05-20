
# ExamFit — Pillar / SRO / SEO Authority / LLM Visibility Rollout

Scope is huge (P1–P7). I'll execute it **phased**, each phase shippable and verifiable, all grounded on the frozen Examiner SSOT (`src/lib/examiner/*`). No phase recomputes readiness/confidence/verdicts — they only read, contextualize, and link.

## Hard rules (apply to every phase)
- Pillar/SRO/SEO/LLM layers MUST import from `@/lib/examiner` only — never compute readiness, confidence, verdicts, or alternative risks.
- No motivational copy. ExaminerToneGuard wording standard everywhere.
- Deterministic, SSR-safe, evidence-grounded. No generated marketing fluff.
- Semantic tokens only (no `text-white`, no raw hex in components).
- New CI guards as we add layers; baseline existing legacy.

## Phase order & deliverables

### P1 — Knowledge Graph + Pillar Foundation
**New SSOT:** `src/lib/semantic/`
- Entity types: `Beruf`, `Pruefung`, `Lernfeld`, `Kompetenz`, `Risiko`, `Fehlerbild`, `Pruefungsform`, `Pruefungsstrategie`, `OralPattern`, `IndustryContext`.
- Graph model (typed, deterministic), pure read-side: `KnowledgeGraph.ts`, `relations.ts`, `resolvers.ts`.
- Resolvers: `relatedCompetencies()`, `relatedRisks()`, `relatedMistakes()`, `relatedOralPatterns()`, `relatedExamScenarios()`.
- Pillar content model: `PillarTypes.ts` (8 pillar kinds).
- Wire to existing certification/curriculum/competency tables via read-only views (no schema migrations in P1 unless gaps force it).
- Golden tests: graph determinism, resolver stability.

### P2 — SRO / LLM Grounding Layer
**New:** `src/lib/llm-grounding/`
- Stable serializers: `examinerEvidenceForLLM()`, `competencySummary()`, `riskExplanation()`, `readinessExplanation()`, `misconceptionSummary()`.
- All outputs deterministic, chunkable, evidence-cited, tone-guarded.
- Entity-first / competency-first / question-first page section components: `<EntityHero>`, `<CompetencyBlock>`, `<EvidenceBlock>`, `<StructuredFaq>`.
- FAQ generator (SSOT-only, no LLM at runtime): `generateFaqFromGraph()`.
- Golden tests: identical input → identical chunks; tone guard pass.

### P3 — SEO Authority Expansion
- Authority cluster mapping (Beruf/Prüfung/Lernfeld/Kompetenz/Fehler/Risiko) — extends existing `seo_cluster_*` SSOT.
- Pillar + satellite route scaffolding (use existing dynamic SEO pages; add resolver bindings).
- Exam-first copy primitives ("Was kommt dran?", "Typische Fehler", "Mündliche Beispiele") — pure components, fed by graph.
- Schema.org markup helpers: `FAQPage`, `HowTo`, `Course`, `EducationalOccupationalProgram`, `DefinedTerm`, `QAPage`, `BreadcrumbList` (`src/lib/seo/schema/`).
- Trust/evidence SEO blocks reusing P2 grounding serializers.

### P4 — LLM Visibility & AI Authority
- AI-quotable content primitives (short precise answers, defined-term blocks).
- Extend `/llms.txt` + `/llms-full.txt` from graph (entity index + pillar index).
- Entity-dominance audit script: coverage per entity type.
- Plug into existing `llm_visibility_*` measurement (cron 138) — add per-entity probes.

### P5 — Conversion & Trust Scaling
- Trust-first UX components: `<ExaminerAuthorityBadge>`, `<ReadinessTrustPanel>`, `<EvidenceBackedRecommendation>` — all pull from frozen Examiner Handover Contract.
- Evidence-based upsell hooks (no fake urgency, no motivational copy).
- B2B authority panels (aggregated readiness/risk views — governance-safe).

### P6 — SEO + SRO Observatory
- Admin cockpit cards:
  - `PillarCoverageCard`, `SemanticGapCard`, `EntityCoverageCard`, `FaqCoverageCard`, `InternalLinkDensityCard`.
- Pillar Health Engine: `scorePillarHealth()` (semantic completeness, evidence density, graph connectivity, FAQ depth, LLM readability).
- SQL views: `v_pillar_health`, `v_semantic_gaps`, `v_entity_coverage`.
- CI guards: `pillar-health-threshold-guard.mjs`, `no-examiner-bypass-in-pillars.mjs`.

### P7 — Final Authority System (integration + freeze)
- Cross-surface coherence test: pillar pages, FAQ blocks, examiner outputs say the same thing for the same entity.
- Documentation: `docs/architecture/pillar-sro-ssot.md`, `docs/contracts/pillar-contracts-v1.md`, `docs/governance/pillar-governance.md`.
- Release certification script + memory freeze.

## Technical anchors (already in repo)
- Examiner SSOT: `src/lib/examiner/{ExaminerConsciousness,ReadinessAuthority,ExaminerEvidence,...}.ts`
- Handover Contract (frozen v1): `docs/contracts/examiner-contracts-v1.md`
- Existing SEO: `src/components/seo/*`, `src/hooks/useSEOKeywords.ts`, `useSEODocuments.ts`, `llm_visibility_*` tables + cron 138.
- Cluster/Pillar DB: `seo_cluster_*`, `cert_pillars`, `pillar_to_cluster`, `persona_landing`, `certification_seo_pages` (per memory).

## What I propose to ship in the **first build pass** after you approve
**Phase P1 only** — the foundation. Concretely:
1. `src/lib/semantic/types.ts` — all entity types + graph edge types.
2. `src/lib/semantic/KnowledgeGraph.ts` — pure in-memory graph builder from existing DB views (read-only).
3. `src/lib/semantic/resolvers.ts` — the 5 related*() resolvers, deterministic.
4. `src/lib/semantic/PillarTypes.ts` — 8 pillar kinds + zod schemas.
5. `src/lib/semantic/index.ts` — barrel.
6. `src/__tests__/semantic-graph.golden.test.ts` — determinism + Examiner-isolation tests (asserts no readiness/confidence computation in semantic layer).
7. `scripts/guards/semantic-no-examiner-bypass.mjs` + workflow — blocks any new readiness/verdict logic in `src/lib/semantic/` or `src/components/pillar/`.
8. Memory file `mem://architektur/semantic/knowledge-graph-foundation-v1.md` + index update.

P2–P7 follow in separate passes once P1 is green and you confirm direction.

## Open questions before P1
1. **Data source for graph nodes** — should I read from existing tables (`certification_catalog`, `curricula`, `learning_fields`, `competencies`, `exam_questions`, `oral_exam_*`) via Supabase views, or do you want a new `semantic_*` materialized layer? Recommended: views first, materialize only if perf demands it.
2. **Scope of "Risk/Mistake" entities** — pull from existing examiner risk taxonomy (`critical_competencies`, evidence severity) or introduce a separate `misconception_catalog`? Recommended: derive from Examiner SSOT — single source.
3. **Pillar pages: new routes or extend existing SEO pages?** Recommended: extend existing `certification_seo_pages` + `persona_landing` with pillar bindings; no new routes in P1.

If you're happy with this plan and the P1 first-pass scope, say "go" (or pick different defaults for the 3 questions) and I'll build P1.
