---
name: P-Completion 2 — Mastery Recovery Loop
description: Recovery-Engine (4 Pfade), useRecoveryPlan, RecoveryPlanCard auf /app/lernpfad + /app/kompetenz, Telemetry über bestehende recommendation_view/click (kein neues event_type)
type: feature
---

# P-Completion 2 — Mastery Recovery Loop

## Ziel
Aus erkannten Schwächen aktive Recovery-Pfade erzeugen: kein „mehr Fragen", sondern „zurück in sicheren Prüfungszustand".
Schließt den Loop **Diagnose → Schwäche → Empfehlung → Lernaktion → Re-Test**.

## SSOT
- `src/lib/recovery/types.ts` — RecoveryRecommendation, 4 RecoveryPathType (`explain_again` · `practice_drill` · `exam_trap_training` · `confidence_recovery`), 8 RecoverySource, 3 Severity-Stufen.
- `src/lib/recovery/engine.ts` — `buildRecoveryPlan({ graph, weakKompetenzIds, signals, aggregateTone, limit })`. Pure, deterministisch. Action-Order:
  1. confidence_recovery (wenn `confidence≤0.4 || hesitation≥0.6`)
  2. exam_trap_training (wenn Kompetenz `cluster_typische_pruefungsfalle | oft_verwechselt | hohe_durchfall_relevanz`)
  3. explain_again (immer — Tutor)
  4. practice_drill (immer — Exam-Trainer)
- Severity-Map: critical||diff≥5→high(6h/+18%), watch||diff≥4→medium(24h/+12%), sonst low(72h/+6%).
- `src/hooks/useRecoveryPlan.ts` — verdrahtet SystemConsciousness + KnowledgeGraph + Weak-Bridge.
- `src/components/recovery/RecoveryPlanCard.tsx` — Drop-in, rendert nichts ohne reale Schwächen.

## CTA-Routen
- `/app/tutor?focus=<key>&mode=explain_again`
- `/app/exam-trainer?focus=<key>&mode=drill|trap`
- `/app/minicheck?focus=<key>&mode=confidence`

## Wiring
- `/app/lernpfad` (AppLernpfadPage): nach `CompetencyStates`, vor `LearnerRecommendationStrip`.
- `/app/kompetenz/:id` (AppKompetenzPage): nach `StabilizationLever`.

## Telemetry
- Bestehende `recordRecommendationView/Click` (event_types `recommendation_view`/`recommendation_click` aus W1 Cut 3b) — kein neues event_type, kein Edge-Function-Deploy nötig.
- `recommendation_id = recovery:<kompetenz_uuid>` für view, `recovery:<uuid>#<path_type>` für click.
- `recommendation_reason = <severity>/<sources>` (view), `…|<path_type>` (click).

## Governance
- Pure Function, kein DB-Write, kein AI-Call.
- Keine engagement-optimierte Copy. Recovery-Reflection ist deterministisch aus Severity-Count abgeleitet.
- Verstößt nicht gegen Architectural Continuity Guard (extends existing recommendation pipeline; kein paralleles System).

## Tests
- `src/__tests__/recovery-engine.golden.test.ts` (8 Tests): Empty-Plan, Severity-Ranking, Trap-Action, Confidence-Collapse, Tone-Escalation, Stabilität, Limit, Reflection.

## Nächste Cuts
- P-Completion 3: Adaptive Exam Engine — dynamische Schwere/Gewichtung pro Block, Recovery zwischen Blöcken.
- P-Completion 4: Recovery Outcome Tracking — Re-Assessment Loop + Mastery-Delta-Persistence in mastery_engine.
