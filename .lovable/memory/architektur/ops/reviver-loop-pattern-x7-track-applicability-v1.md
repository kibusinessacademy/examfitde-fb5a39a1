---
name: Pattern X7 — Reviver-Induced Phantom-Enqueue Loop
description: learning-content-revive resette skipped (TRACK_NOT_APPLICABLE) Steps zurück auf queued, was atomic-enqueue + phantom-block in Endlos-10min-Loop trieb. Fix in 3 Schichten — TS-Guard, Trigger-Guard mit enqueue_source, Re-Skip in fn_atomic_enqueue.
type: feature
---

## Symptom
- Pakete (z. B. Kanalbauer/-in, EXAM_FIRST track) zeigten 100+ `enqueue_phantom_blocked` Audit-Events / 24h für `package_generate_learning_content`.
- `package_steps.meta` enthielt sowohl `skip_source: trg_auto_skip_not_applicable_package_step_v2` als auch `liveness_requeued: true` mit `liveness_requeue_reason: fully_idle`.
- 222 Pakete systemweit betroffen.

## Root Cause
`supabase/functions/_shared/learning-content-revive.ts::reviveLearningContentStepIfDead` setzte ALLE non-done Steps mit `needsRegen > 0` und Verdict `fully_idle` zurück auf `queued`, **ohne** zu prüfen ob der Step bereits `skipped` ist UND der Skip-Grund Track-Not-Applicable war.

Pipeline:
1. Step `skipped` (TRACK_NOT_APPLICABLE_LEARNING_CONTENT)
2. Reviver alle ~10min: status='queued', meta.liveness_requeued=true
3. `trg_auto_skip_not_applicable_package_step_v2` re-skipped sofort wieder auf `skipped` (existierender Schutz greift)
4. ABER: Cancel-Loop-Audits von `enqueue_phantom_blocked` füllen `auto_heal_log` 

Der Loop war daten-konsistent, aber log-spammend und zeigte unnötig in der Cockpit-Anzeige als Pattern-Failure.

## Fix (3 Schichten)

### 1) TS-Guard im Reviver
`learning-content-revive.ts` bricht ab wenn:
- `step.status === 'skipped'` UND
- `meta.skipped_reason === 'TRACK_NOT_APPLICABLE_LEARNING_CONTENT'` ODER `meta.skip_reason ILIKE %not_applicable%` ODER `meta.skip_source LIKE 'trg_auto_skip_not_applicable%'`

### 2) `fn_atomic_enqueue_on_step_queued` Hardening
- **Applicability Pre-Check** via `fn_is_step_applicable_for_package(pkg, step)` als ERSTES nach pkg.status check. Wenn nicht applicable → Step direkt auf `skipped`, kein Job-Insert.
- **enqueue_source-Tag** (`'trg_atomic_enqueue'`) jetzt verpflichtend in payload (Phase-1 warn-only Guardrail erfüllt).

### 3) Bulk-Heal
222 Pakete einmalig auf `skipped` re-set, alle pending phantom-Jobs cancelled mit `last_error_code='PATTERN_X7_PHANTOM_SKIPPED'`.

## Files
- `supabase/functions/_shared/learning-content-revive.ts` (Lines 290-303 erweitert)
- Migration `20260502063648_*.sql`

## Verifikation
- Kanalbauer (`d0790f35-...`): pkg=building, step=skipped, 0 phantom-blocks in letzten 5 min.
- Cockpit zeigt das Paket nicht mehr in „Root-Cause (AI)".
