---
name: P-Completion 3 — Adaptive Exam Engine
description: Pure deterministische Engine — Blueprint × Mastery × Weakness × Recovery → AdaptiveExamPlan + Outcome (Readiness-Delta + Tutor-Follow-ups). Blueprint-konform, Drift gekappt, keine freien Fragen.
type: feature
---

# P-Completion 3 — Adaptive Exam Engine

## Ziel
Prüfungssimulation passt sich an echte Schwächen an, ohne Prüfungslogik zu verfälschen. Blueprint bleibt SSOT — die Engine verschiebt Gewichte gekappt (±0.15 default), plant Re-Test-Blöcke nach Recovery und liefert nach Abschluss Readiness-Delta + Tutor-Follow-ups.

## SSOT
- `src/lib/exam/adaptiveEngine.ts` — `buildAdaptiveExamPlan(input)` + `computeAdaptiveExamOutcome(plan, results)`. Rein, deterministisch (FNV-1a Signatur), keine Netz-Calls.
- `src/lib/exam/types.ts` — geschlossene Taxonomie: `ExamSlotKind = blueprint_core|weakness_focus|retest|stability_anchor`, `RecoveryPathType`-Mirror für Follow-ups.
- `src/hooks/useAdaptiveExamPlan.ts` — Bridge: Blueprint (vom Caller) + KnowledgeGraph + SystemConsciousness + useRecoveryPlan.
- `src/components/exam/AdaptiveExamPlanCard.tsx` — Drop-in Anzeige (Drift, Re-Test, Difficulty-Pool, Konformität).

## Algorithmus
1. **Normalisierung** Blueprint-Weights → Σ=1.
2. **Adaption**: weak_kompetenz_ids erhalten Boost `0.05 + (1-mastery)*0.15`, gekappt durch `max_drift`. Reduktion proportional auf non-weak.
3. **Slot-Allocation** via Largest-Residual-Rounding (deterministisch nach `rem desc, id asc`).
4. **Difficulty-Pool** matcht Blueprint-Distribution exakt; Pick-Reihenfolge: weak → easy>medium>hard, stark (mastery≥0.75) → hard>medium>easy, sonst medium>hard>easy.
5. **Stability-Anchor**: erster Slot → kind=stability_anchor + easy wenn `signals.structureStability < 0.5`.
6. **Re-Test-Block**: bis zu 3 letzte Slots gebunden an `recoveryCompetencyIds` (nur falls in Blueprint vorhanden); Schwierigkeit nie hard.
7. **Konformität** = `1 - Σ|Δw|/2`, exponiert in UI.

## Outcome
- per_competency mastery_delta linear in `[-0.18, +0.18]` (`(acc - 0.5) * 0.36`).
- readiness_delta in `[-20, +20]` aus score + weakPenalty.
- tutor_followups mapped auf RecoveryPathType: ≤0.25 explain_again · ≤0.5 practice_drill · ≤0.75 exam_trap_training · sonst confidence_recovery.

## Constraints
- KEINE freie Fragenerzeugung — Engine emittiert nur Slot-Specs (competency_id + difficulty + kind). Picker downstream zieht echte exam_questions per SSOT.
- KEIN Backend-Write. KEIN Shadow-State.
- Drift hart gekappt — Konformität deterministisch + transparent.
- Reproduzierbar: gleiche Inputs → identische Signatur (FNV-1a).

## Wiring
- `AppExamTrainerPage` Pre-Exam-Panel zeigt `AdaptiveExamPlanCard` (Demo-Blueprint bis per-Curriculum-Wiring via `useExamSimulation` folgt).

## Tests
- `src/__tests__/adaptive-exam-engine.golden.test.ts` (9 Tests): No-weakness=Blueprint identisch, Drift-Cap, Signatur-Stabilität, Re-Test-Mapping, Anchor, Difficulty-Total-Exaktheit, Empty-Blueprint, Outcome + Follow-up-Pfad-Mapping, Best-Case.

## Nächste Cuts
- C3-Wire: `useExamSimulation`-Blueprint + DB-Mastery in `useAdaptiveExamPlan` einspeisen (Server-RPC liefert weights + mastery).
- C3-Result: Post-Exam `computeAdaptiveExamOutcome` an Tutor-Follow-up-Surface + `setReadiness`-Delta verdrahten.
