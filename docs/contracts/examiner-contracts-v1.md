# Examiner Contracts v1.0.0

_Status: **frozen** — Änderungen nur über Major-Version._

Quelle: `src/lib/examiner/ExaminerContracts.ts`

## Verdict Schema

```
ready_for_exam | approaching_readiness | needs_work | not_ready
```

## Readiness Authority States

```
ready_for_exam | conditionally_ready | readiness_risk | not_ready
```

Thresholds (`ReadinessAuthority.ts`):

| State                  | minReadiness | minConfidence |
| ---------------------- | ------------ | ------------- |
| ready_for_exam         | 80           | 0.70          |
| conditionally_ready    | 65           | 0.55          |
| readiness_risk         | 50           | 0.40          |
| not_ready              | 0            | 0.00          |

## Confidence Schema

- min: 0, max: 1, precision: 2

## Evidence

- Severity: `info | warning | critical`
- Chain-Länge ≤ 3 Items
- Felder: `source_attribution`, `severity`, `confidence`

## Timeline Event Kinds

```
input | evidence | deliberation | verdict | confidence | risk | threshold
```

## Replay

`ExaminerReplay.replayExaminerDecision` muss bei identischem Input
identische Ausgabe liefern (deterministische Sortierung,
gerundete Confidence, stabile Evidence-Reihenfolge).

## Readiness Output Contract (Handover)

```ts
{
  readiness_state,
  readiness_confidence,
  top_risks,
  supporting_evidence,
  critical_competencies,
  trend_signal,
  exam_consistency
}
```

Diese Outputs sind SSR-safe, SEO-safe, pillar-safe, deterministic.
