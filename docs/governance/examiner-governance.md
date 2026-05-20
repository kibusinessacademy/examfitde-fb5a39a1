# Examiner Governance

_Status: **enforced** (Phase 8.9b)_

## Single Source of Truth

Nur Dateien unter `src/lib/examiner/**` (und unterstützend
`src/lib/system/**`) dürfen:

- Readiness berechnen
- Confidence erzeugen
- Evidence generieren
- Verdicts ableiten

Alle anderen Dateien **konsumieren** ausschließlich die Facade
`useExaminerConsciousness()`.

## CI Guards

| Guard | Datei | Zweck |
| --- | --- | --- |
| Copy Governance | `scripts/guards/examiner-copy-governance.mjs` | Verbietet motivationale/gamification-Sprache |
| Legacy Logic | `scripts/guards/examiner-legacy-logic.mjs` | Verbietet lokale Readiness/Verdict/Risk-Heuristiken |
| Parallel Readiness | `scripts/guards/examiner-no-parallel-readiness.mjs` | Verbietet neue Quellen für Readiness/Confidence/Verdict/Evidence außerhalb SSOT |
| Release Certification | `scripts/guards/examiner-release-certification.mjs` | Aggregiert Gate-Status, schreibt Release-Report |

## Runtime Guards

- `ExaminerCoherenceGuard.assertSnapshotCoherence`
- `ExaminerCoherenceGuard.assertCrossSurfaceCoherence`
- `ExaminerLegacyGuard.assertNoSurfaceRiskDrift`
- `ExaminerToneGuard` (Sprach-Tone)

## Golden Suites

- `examiner-coherence.golden.test.ts`
- `examiner-evidence.golden.test.ts`
- `examiner-deliberation.golden.test.ts`
- `examiner-tone-and-drift.golden.test.ts`
- `examiner-e2e-validation.golden.test.ts`

## Änderungsregeln (Foundation Frozen)

Neuer Code darf:

- bestehende Contracts konsumieren
- bestehende Examiner-Outputs lesen
- bestehende Evidence rendern

Neuer Code darf **nicht**:

- neue Readiness-Logik einführen
- neue Verdict-Systeme schaffen
- parallele Confidence-Systeme bauen
- alternative Evidence-Chains erzeugen
- Frontend-/Surface-Heuristiken einführen

Ausnahmen werden ausschließlich in
`docs/exceptions/examiner-legacy-exceptions.md` dokumentiert.
