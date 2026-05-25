---
name: W1 Cut 3b — Adaptive Decision Telemetry + Semantic Recommendation Intelligence v1
description: adaptive_cta_decision/recommendation_view/recommendation_click event_types (edge allowlist), structured bucketing (readiness/exam_phase/session_depth/confidence), deterministic recommendForWeaknesses engine, weakness cluster classifier, RecommendationStrip surface, AdaptiveHero auto-emit. No DB migration — piggybacks conversion_events via track-funnel-event.
type: feature
---

## Scope
W1 Cut 3b — Moat Layer. Frontend + edge-allowlist only. **No DB migration.**
Builds on Cut 3 Adaptive CTA Engine + P1 KnowledgeGraph.

## Hard rules
- Adaptive decisions + recommendations are pure functions (no AI, no random, no network).
- Never recomputes readiness/mastery/verdict — examiner-isolated (mirror via Handover only).
- Telemetry carries **structured fields only** — no free text, no chat content, no PII.
- Recommendations MUST be prüfungsbezogen + lernwirksam + kompetenzlogisch + erklärbar. NEVER "users also bought" / engagement-optimised / blackbox.
- Same input ⇒ same output (golden tests).

## SSOT additions
### Telemetry — `src/lib/intent/decision-telemetry.ts`
- 3 governed event_types via existing `track-funnel-event` edge:
  - `adaptive_cta_decision` (phase: rendered | clicked)
  - `recommendation_view`
  - `recommendation_click`
- Pflichtfelder pro `adaptive_cta_decision` metadata:
  `entity_kind · entity_slug · intent_kind · readiness_bucket · emotional_state · cta_variant · tone · explainable_cta_reason · recommended_action · confidence_bucket · exam_phase · session_depth_bucket · phase · urgency_level`
- Bucketing helpers (deterministic): `readinessBucket`, `confidenceBucket`, `examPhase`, `sessionDepthBucket`.
- `buildAdaptiveCtaDecisionPayload` exposed for golden tests.

### Recommendation engine — `src/lib/recommendations/`
- `engine.ts → recommendForWeaknesses(graph, { weak_kompetenz_ids, exam_form, days_to_exam, limit })`
- Strategy: traverse 7 curated EdgeKinds (`kompetenz_has_{risiko,fehlerbild,oral_pattern,tutor_topic,lernpfad}`, `related_competency`, `related_mistake`), score via `similarity × 0.45 + exam_relevance × 0.3 + weakness_relation × 0.2 + min(1, overlap/5) × 0.05`, sort deterministically.
- Days-to-exam ≤14 ⇒ drops `preventive` recs.
- Never recommends weak competency back to itself.
- `weakness-clusters.ts` — 5-tag closed taxonomy (`typische_pruefungsfalle | oft_verwechselt_mit | hohe_durchfall_relevanz | muendliche_pruefung_kritisch | zeitdruck_anfaellig`), deterministic classifier reading `Kompetenz.meta` + `difficulty≥4`.

### Edge function
- `supabase/functions/track-funnel-event/index.ts` ALLOWED_EVENTS erweitert um die 3 neuen event_types. Keine package_id-Pflicht (Cut 3b ist learner-context-events, nicht funnel-strict).

### KnowledgeGraph
- `KnowledgeGraph.toSnapshot()` neu — SSOT-konformer Re-Export für Engines/Tests ohne Reach-In.

## UI
- `src/components/recommendations/RecommendationStrip.tsx` — "Azubis mit ähnlichen Schwächen trainieren häufig zuerst …", fired-once-per-mount telemetry, click-tracking, cluster-badges.
- `src/components/intent/AdaptiveHero.tsx` — neue `telemetry`-Prop, auto-emit `rendered` on mount + `clicked` on press (mit `enabled:false` fürs Test-Opt-Out).
- `src/pages/wissen/EntityPillarPage.tsx` — wired für `kind === "kompetenz"` (Pillar-Seed). Learner-Surfaces folgen.

## Tests
- `src/__tests__/recommendations-and-telemetry.golden.test.ts` — **15 tests grün** (determinism, no-self-recommend, oral exam_form bias, imminent drops preventive, empty inputs, cluster classification + ordering, bucket helpers, payload-SSOT contract, similarity clamp).
- `src/__tests__/adaptive-cta.golden.test.ts` — 9 tests grün (unverändert).
- `src/__tests__/intent-router.golden.test.ts` — 7 tests grün (unverändert).

## Deploy
- `track-funnel-event` redeployed (allowlist active).
- Smoke folgt automatisch sobald erste Pillar-Seite gerendert wird (auto-emit on mount).

## Next (Cut 3c / Product Completion)
- Wire `RecommendationStrip` in Learner-Surfaces (LessonReader, AfterQuiz) mit echten `weak_kompetenz_ids` aus `useExaminerHandover`.
- Admin-Cockpit-Card: `adaptive_cta_decision` × `cta_variant` × `explainable_cta_reason` × outcome (rendered→clicked-Rate, click→checkout-Rate).
- Bridge `recommendation_click` → next-best-action funnel.
- **STOP der Convergence-Welle** — Cut 3c ist Übergang zu Product Completion Sprint (Oral Exam System, AI Tutor Completion, Readiness OS, Learning Journey).
