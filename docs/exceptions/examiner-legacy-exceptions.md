# Examiner Legacy Exceptions

_Status: nachverfolgt — keine stillen Ausnahmen erlaubt._

Jede Ausnahme MUSS hier dokumentiert und in der Baseline des jeweiligen
Guards (`scripts/guards/examiner-legacy-logic.mjs`,
`scripts/guards/examiner-no-parallel-readiness.mjs`) referenziert sein.

## Aktive Ausnahmen

### RiskCostWidget

- **component:** `src/components/dashboard/RiskCostWidget.tsx`
- **reason:** Berechnet `failRisk` als reine UI-Heuristik
  (`100 - score * 1.1`) auf Basis der Legacy-Hook
  `useReadinessScore(curriculumId)`. Dient ausschließlich der
  Visualisierung im Dashboard-Widget; trifft keine prüferische
  Entscheidung.
- **scope:** Eine Datei, eine Zeile (Zeile 14 — `local_risk_derive`).
- **mitigation:**
  - Widget rendert nur Risiko-Hinweis, nie Verdict / Readiness-State.
  - Schwelle (`score >= 85` → unsichtbar) verhindert Konflikt mit
    Authority-State `ready_for_exam`.
  - Keine Konsumierung durch SEO/SSR/Pillar/SRO.
- **owner:** Examiner Core (Dashboard-Surface)
- **removal_condition:** Migration auf
  `useExaminerConsciousness().authority` +
  `deliberation.blocking_risks` mit eigenständigem
  `RiskCostFromAuthority`-Renderer. Geplant im Surface-Refactor nach
  Pillar/SRO-Block.
- **baseline_key:**
  `src/components/dashboard/RiskCostWidget.tsx:14:local_risk_derive`

## Regel

Neue Ausnahmen ohne Eintrag in dieser Datei **gelten als Verstoß** und
müssen durch die CI-Guards blockiert werden.
