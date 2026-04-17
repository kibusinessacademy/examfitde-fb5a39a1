---
name: D+ Phase 2 — package-repair-exam-pool-lf-coverage
description: Targeted LF deficit repair Edge Function. Liest fn_classify_exam_pool_gate + fn_get_lf_coverage_deficit, fan-out per Defizit-LF nach package_generate_exam_pool mit lf_target_total. NIEMALS Full-Regen, KEIN State-Hack.
type: feature
---

## Verantwortlichkeit

`supabase/functions/package-repair-exam-pool-lf-coverage/index.ts`

Job-Type `package_repair_exam_pool_lf_coverage` (registriert in `ops_job_type_registry`, `_shared/job-map.ts`, `_shared/enqueue.ts` REPAIR_JOB_TYPES, `src/lib/jobs/job-registry.ts`).

## Harte Guardrails (in dieser Reihenfolge)

1. **Eligibility** via `fn_is_repair_action_eligible` (fail-closed für Automation)
2. **Gate-Klassifikation** via `fn_classify_exam_pool_gate`
   - PASS → done (skip)
   - HARD_FAIL ohne Coverage-Cause → blocked (nicht unsere Aufgabe)
   - `recommended_action != enqueue_lf_coverage_repair` → blocked (mismatch)
3. **Dedup**: aktive `package_generate_exam_pool` Jobs mit `payload._origin = 'enqueue_lf_coverage_repair'` → skip
4. **Throttle**: ≥2 `no_effect`-Runs in den letzten 30 Min → blocked
5. **Snapshot** via `fn_capture_gate_snapshot` (vor Dispatch)
6. **Defizit-Berechnung** via `fn_get_lf_coverage_deficit(target_per_lf=15)`
   - leere Liste → done (skip)

## Targeted Fan-out (kein Full-Regen)

Pro Defizit-LF wird ein `package_generate_exam_pool` Job enqueued mit:
```json
{
  "_fan_out": true,
  "learning_field_filter": "<lf_uuid>",
  "lf_target_total": <target_count>,
  "_origin": "enqueue_lf_coverage_repair",
  "_origin_job_id": "<repair_job_id>",
  "deficit": <n>
}
```

Der bestehende `package-generate-exam-pool` Worker:
- läuft im fan-out Modus per `learning_field_filter`
- respektiert `lf_target_total` als absolute Soll-Zahl pro LF
- triggert ANTI-DOMINANZ CAP (≤25%) verhindert Skew-Wachstum
- nach Completion via batch-result-importer / job-runner: re-evaluiert validate_exam_pool

## Was die Function NICHT tut

- KEIN `validate_exam_pool` State-Rewind (`status='queued'` wäre Trigger-Konflikt)
- KEIN pauschales Requeue
- KEIN Full-Regenerate als Fallback
- KEIN markStepDone der canonical pipeline (repair step ist außerhalb der 29-Step Pipeline)

## Re-Validation

Erfolgt durch normalen Pipeline-Flow nachdem die fan-out Jobs durchlaufen sind. Der job-runner evaluiert nach jeder generate_exam_pool Completion automatisch die nachfolgenden Steps.
