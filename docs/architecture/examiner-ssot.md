# Examiner SSOT Architecture

_Status: **production-frozen** (Phase 8.9b, Contracts v1.0.0)_

## Zweck

Eine einzige, kohärente prüferische Wahrheit über alle Surfaces (Tutor,
Oral, MiniCheck, ExamTrainer, Lernpfad, Dashboard, Admin, Landing).

## Schichten

```text
┌──────────────────────────────────────────────────────────────┐
│  Surfaces  (Pages, Components, Cards)                        │
│   └─ lesen ausschließlich via useExaminerConsciousness()     │
├──────────────────────────────────────────────────────────────┤
│  Facade:  src/lib/examiner/ExaminerConsciousness.ts          │
├──────────────────────────────────────────────────────────────┤
│  Authority:    ReadinessAuthority.ts                         │
│  Deliberation: ExaminerDeliberation.ts                       │
│  Longitudinal: ExaminerLongitudinal.ts                       │
│  Evidence:     ExaminerEvidence.ts                           │
│  Tone:         ExaminerToneGuard.ts                          │
│  Log/Replay:   ExaminerDecisionLog.ts / ExaminerReplay.ts    │
│  Lexicon:      ExaminerLexicon.ts                            │
│  Coherence:    ExaminerCoherenceGuard.ts                     │
│  Contracts:    ExaminerContracts.ts (frozen v1.0.0)          │
├──────────────────────────────────────────────────────────────┤
│  Perception:   src/lib/system/* (Risks, Memory, Signals…)    │
└──────────────────────────────────────────────────────────────┘
```

## Regeln

- Surfaces erzeugen **keine** Readiness, Confidence, Verdicts oder
  Evidence. Sie konsumieren ausschließlich die Facade.
- Determinismus: Gleicher Input → gleiches Verdict, gleiche
  Evidence-Reihenfolge, gleiche Confidence (Precision 2).
- SSR-/Hydration-stabil: keine Date.now()/Math.random() in
  Examiner-Pfaden.
- Tone-Guard blockiert motivationale Sprache zur Laufzeit.

## Konsumpfad

```ts
import { useExaminerConsciousness } from "@/lib/examiner/ExaminerConsciousness";
const { authority, deliberation, verdictEvidence, topRiskEvidence, trend, stability } = useExaminerConsciousness();
```
