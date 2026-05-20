---
name: C1/C6/C7/C8 strukturelle Fail-Reduction v1
description: Reschedule-Lock + Attempts-Reset für lf_repair Parent-Job, Per-Blueprint-Fanout in enqueue_blueprint_gap_jobs (heilt MISSING_BLUEPRINT_ID 400-Loop), Dead-Import-Cleanup in pool-fill-bloom-gaps (Gateway-only). SEALED_COURSE bleibt via TERMINAL_PATTERNS terminal.
type: feature
---

## C1 — LF-Coverage Re-Schedule-Lock
- Entry-Dedup im Worker `package-repair-exam-pool-lf-coverage`: bei mehreren parent-Jobs für selbes package_id self-cancel mit code `LF_REPAIR_RESCHEDULE_LOCK`.
- Re-Park (Branch 1 + initialer Park nach Dispatch): `attempts := 0` — Warten auf Kinder verbraucht KEIN Retry-Budget mehr → kein MAX_ATTEMPTS_EXHAUSTED Loop.
- Hilfsfunktion `public.fn_lf_repair_has_active_children(parent_job_id)` (SECURITY DEFINER, service_role only) prüft `meta.child_job_ids` gegen aktive job_queue-Zeilen.
- Cleanup: stuck `package_repair_exam_pool_lf_coverage` Parents mit attempts>=max in einem Schritt nach `failed` überführt + Audit `c1_lf_repair_max_attempts_terminal_cleanup`.

## C6 — Blueprint-Enqueue-Contract
- `enqueue_blueprint_gap_jobs` re-implementiert: pro Defizit-Kompetenz alle approved Blueprints (question_blueprints) auflösen, dann **ein Job pro blueprint_id** als `package_generate_blueprint_variants` (pool=`default`).
- Payload jetzt strikt: curriculum_id + package_id (aus course_packages) + blueprint_id + competency_id + count.
- Wenn keine approved BPs existieren: KEIN Job ohne blueprint_id mehr — stattdessen Audit `blueprint_gap_no_approved_blueprints` (skipped).
- Behebt 7+ MISSING_BLUEPRINT_ID 400-Failures in den letzten 5 Tagen.

## C7 — Bloom-Gap AI-Pfad
- `pool-fill-bloom-gaps` nutzt seit Patch D.2 bereits direkten Lovable AI Gateway (LOVABLE_API_KEY). Dead `callAIJSON`-Import entfernt → Phase-2 Gateway-Bypass-Guard bleibt grün.

## C8 — SEALED_COURSE
- Bereits in `TERMINAL_CODES` + `TERMINAL_PATTERNS` (`pipeline-logic-test/index.ts` Z. 831/836) als permanent non-retryable klassifiziert. Letzte 5 Tage: 2 jobs failed, KEIN Requeue-Loop. Kein weiterer Code-Change nötig.

## Audit action_types (in ops_audit_contract registriert)
- `lf_repair_reschedule_lock_self_cancel`
- `c1_lf_repair_max_attempts_terminal_cleanup`
- `blueprint_gap_no_approved_blueprints`
- `enqueue_blueprint_gap_jobs_per_blueprint_fanout`

## Vorher → Nachher (Erwartung)
| Cluster | Vorher (5d) | Nachher |
|---|---|---|
| `package_repair_exam_pool_lf_coverage` MAX_ATTEMPTS | 1 fail + Park-Loops | 0 — Park kostet keine Attempts mehr |
| `blueprint_generate_variants` MISSING_BLUEPRINT_ID | 7 | 0 — Per-BP-Fanout oder skipped+Audit |
| `pool_fill_bloom_gaps` GOOGLE_AI_API_KEY-Leak | dead import | weg, Guard grün |
| SEALED_COURSE | 2 terminal, kein Loop | unverändert (bereits ok) |
