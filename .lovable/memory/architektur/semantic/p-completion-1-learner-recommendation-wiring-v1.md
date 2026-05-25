---
name: P-Completion 1 — Learner Recommendation Wiring
description: SSOT-Bridge SystemConsciousness.risks → Kompetenz-IDs, useLearnerRecommendationContext, LearnerRecommendationStrip auf /app, /app/lernpfad, /app/exam-trainer
type: feature
---

# P-Completion 1 — Learner Recommendation Wiring

## Ziel
Aus echten Schwächen (SystemConsciousness `risks`) automatisch konkrete, deterministische, prüfungsnahe Next-Best-Action-Empfehlungen erzeugen — direkt im Lernbereich, Lernpfad und Prüfungstrainer. Kein Mock, kein "andere Nutzer haben gekauft", keine AI-generierten freien Texte.

## SSOT
- `src/lib/recommendations/weak-kompetenz-bridge.ts` — `resolveWeakKompetenzIds({ graph, risks, limit })`. Pure, deterministisch. Scoring: `linked_risk_keys`==RiskKey (+3), key==RiskKey (+3), key⇄RiskKey prefix (+2), name enthält Token (+1); ×Tone (critical=2, watch=1, stable=0).
- `src/hooks/useLearnerRecommendationContext.ts` — verdrahtet `useSystemConsciousness()` + `useKnowledgeGraph()` + Bridge.
- `src/components/recommendations/LearnerRecommendationStrip.tsx` — Drop-in-Wrapper, rendert nichts wenn `weakKompetenzIds.length === 0` (kein Demo-Fallback).

## Wiring
- `/app` (AppOverviewPage): nach Sekundär-Karten, vor Konto-Drilldown. `source=app_overview`.
- `/app/lernpfad` (AppLernpfadPage): nach `CompetencyStates`, vor `StrategistTutor`. `source=app_lernpfad`, limit=4.
- `/app/exam-trainer` (AppExamTrainerPage): in Pre-Exam-Panel. `source=app_exam_trainer`, `examForm=schriftlich`, limit=3.

## Governance
- Engine = `recommendForWeaknesses` (W1 Cut 3b). Telemetry über `RecommendationStrip` bleibt aktiv (view+click).
- KEINE Engagement-Optimierung, KEIN Collaborative Filter, KEINE freie AI.
- Bridge ist Read-only — schreibt nie auf risks/graph.

## Tests
- `src/__tests__/weak-kompetenz-bridge.golden.test.ts` (5 Tests): deterministisches Ranking, ignoriert stable, leer ohne aktive Risks, Limit, Stabilität.
- Bestehende `recommendations-and-telemetry.golden.test.ts` (15 Tests) weiterhin grün.

## Nächste Cuts (P-Completion)
- C2: Tutor-Hints → MiniCheck/Mastery-Bridge (RecoveryLogic → useLearnerRecommendationContext mit Lesson-Kontext).
- C3: Oral-Exam Persona+Recovery (Cut Sequence aus Audit).
