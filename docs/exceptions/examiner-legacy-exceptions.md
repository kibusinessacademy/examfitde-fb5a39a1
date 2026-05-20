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

### Admin Publish Blockers — `L2EnforceReadinessCard`

- **component:** `src/components/admin/publish-blockers/L2EnforceReadinessCard.tsx`
- **reason:** Admin-Tool für L2-Publish-Gate (Content-Pipeline), nicht
  prüferische Learner-Readiness. Eigener `type Readiness` lokal.
- **scope:** Admin-only, keine Learner-Surface, keine SSR/SEO-Ausgabe.
- **mitigation:** Klare Namensgebung im Admin-Kontext; Umbenennung in
  `type L2PublishReadiness` geplant.
- **owner:** Content Ops
- **removal_condition:** Rename + Move nach `src/lib/admin/publish/**`.
- **baseline_key:** `src/components/admin/publish-blockers/L2EnforceReadinessCard.tsx:17:interface_examiner_output`

### B2B RiskBadge

- **component:** `src/components/b2b/RiskBadge.tsx`
- **reason:** B2B-Cockpit-Badge mit eigenem `Verdict`-Literal-Set für
  Account-/Seat-Status; nicht prüferisches Verdict.
- **scope:** B2B-Admin-Cockpit, kein Learner-Surface.
- **mitigation:** Wird in Track 8 (B2B-Refactor) auf
  Authority-Outputs gemappt.
- **owner:** B2B Platform
- **removal_condition:** Mapping auf `authority.state`.
- **baseline_key:** `src/components/b2b/RiskBadge.tsx:4:interface_examiner_output`

### Mastery API — `computeReadiness`

- **component:** `src/features/mastery/api/masteryApi.ts`
- **reason:** Legacy Mastery-RPC-Wrapper (server-side
  `compute_readiness`), liefert Rohdaten für `useReadinessScore`. Wird
  vom Examiner-SSOT als **Perception-Input** konsumiert, nicht als
  Verdict-Quelle.
- **scope:** Datenholer, kein Verdict, keine Confidence.
- **mitigation:** Umbenennung in `fetchMasterySnapshot` geplant; bis
  dahin nicht in neuen Surfaces verwenden.
- **owner:** Examiner Core
- **removal_condition:** Rename + Verschiebung nach
  `src/lib/system/perception/**`.
- **baseline_key:** `src/features/mastery/api/masteryApi.ts:46:decl_readiness_state`

### Phantom-Step E2E Test Runner

- **component:** `src/lib/admin/runPhantomStepE2ETest.ts`
- **reason:** Test-Harness `Verdict = pass|fail|warn|skip` — reines
  E2E-Smoke-Ergebnis, kein prüferisches Verdict.
- **scope:** Admin-Test-Tool.
- **mitigation:** Umbenennung in `type SmokeOutcome` geplant.
- **owner:** Platform Ops
- **removal_condition:** Rename.
- **baseline_key:** `src/lib/admin/runPhantomStepE2ETest.ts:3:interface_examiner_output`

## Regel

Neue Ausnahmen ohne Eintrag in dieser Datei **gelten als Verstoß** und
müssen durch die CI-Guards blockiert werden.
