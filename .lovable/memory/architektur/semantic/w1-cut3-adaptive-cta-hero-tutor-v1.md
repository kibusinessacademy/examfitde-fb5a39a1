---
name: W1 Cut 3 Adaptive CTA + Hero/Tutor/Confidence Intelligence v1
description: Adaptive CTA Engine (8 variants × 4 tones, deterministic explainable_cta_reason), TutorHint SSOT (8 kinds), AdaptiveHero + ConfidenceStatusStrip Components. Examiner-isolated, pure functions. Wired into EntityPillarPage.
type: feature
---

## Scope
W1 Cut 3 — Adaptive Surfaces. Frontend-only, no DB migration, no AI calls.
Builds on Cut 2 Intent SSOT.

## SSOT additions
- `src/lib/intent/adaptive-cta.ts` — `chooseAdaptiveCta(intent, signals, extra)` → `{ variant, tone, urgency_level, action_type, message, reason }`. 8 variants: motivational | urgency | risk | confidence | simulation | oral | recovery | diagnostic. 4 tones. **Every output carries `reason`** (explainable_cta_reason).
- `src/lib/intent/tutor-hints.ts` — `tutorHint(intent, signals, ctx)` → 8 hint kinds (confusion_pattern, high_uncertainty, simplify_first, challenge_up, exam_imminent, repeat_failure, encouragement, neutral). Framing only — never overrides Strict-RAG.
- `src/lib/intent/index.ts` — re-exports adaptive-cta + tutor-hints.

## UI
- `src/components/intent/AdaptiveHero.tsx` — variant-driven headline + tone-driven gradient + explainable `data-cta-*` attrs (`data-cta-reason`, `data-cta-variant`, `data-cta-tone`, `data-cta-urgency`).
- `src/components/intent/ConfidenceStatusStrip.tsx` — 4-Antworten-Strip (Readiness | Risiko | Größte Lücke | Trend). Pure presentation — values vom Caller (Examiner-Handover-Contract).
- `src/pages/wissen/EntityPillarPage.tsx` — AdaptiveHero über GroundingChunkList; ConfidenceStatusStrip unter ReadinessSignalBlock (nur beruf|pruefung).

## Decision priority (adaptive CTA)
1. `durchgefallen` → recovery (empathic)
2. `muendliche_pruefung` → oral
3. `days_to_exam ≤ 14` → urgency critical / `≤ 42` → urgency high
4. `risk_level=high` → risk (empathic)
5. `readiness_score ≥ 75` + `risk_level=low` → confidence
6. `risk_level=medium` + sessions ≥ 3 → simulation
7. `repeat_failures ≥ 3` → recovery
8. unknown / no readiness → diagnostic
9. else → motivational

## Hard rules
- Pure functions — no AI, no network, no random. Same input ⇒ same output.
- Never recomputes readiness/mastery/verdict (examiner-isolated).
- Every CTA + tutor hint carries `reason` for audit + analytics.
- Adds zero new IntentKinds — extends Cut 2 SSOT only.
- TutorHint is framing only — never overrides Strict-RAG citations.

## Tests
- `src/__tests__/adaptive-cta.golden.test.ts` — 9 tests grün (recovery dominates, oral surface, exam imminent, high risk, high mastery, no-baseline diagnostic, determinism, tutor confusion pattern, tutor exam_imminent).
- `src/__tests__/intent-router.golden.test.ts` — 7 tests grün (unverändert).

## Next (Cut 3b — optional)
- Wire AdaptiveHero into public landing (`/`, `/wissen`) — needs intent-from-path + UTM.
- Surface TutorHint in `AiTutorChat` framing (NOT in model prompt).
- Producer für `adaptive_cta_decisions` Event-Stream → conversion_events bridge + DB-View für Auswertung Variant × Reason × Conversion.
- Semantic Recommendation Layer (Cut 3E): "Azubis mit ähnlichen Schwächen trainieren häufig zuerst …" basierend auf weak-competency-cooccurrence.
