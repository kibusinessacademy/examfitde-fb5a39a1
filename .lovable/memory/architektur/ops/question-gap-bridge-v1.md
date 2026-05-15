---
name: Question-Gap-Bridge v1 (Bridge #3)
description: QUESTION_GAP_ONLY → gezielte Frage-Materialisierung aus approved Variants. Per-LF idempotent, kein Blueprint/Variant-Reenqueue.
type: feature
---
# Question-Gap-Bridge v1

Schließt LF-Gaps wo Blueprints + approved Variants vorhanden sind, aber Fragen fehlen
(`gap_class='QUESTION_GAP_ONLY'` AND `usable_variant_count > 0` AND `question_deficit > 0`).

## Pipeline
1. SSOT-View `v_exam_pool_lf_repair_gap_classification` liefert pro Paket × LF die Gap-Klasse.
2. `admin_dispatch_question_gap_bridge(pkg)` enqueued pro fehlendem LF einen Job:
   - `job_type='package_repair_exam_pool_lf_coverage'`
   - `payload._origin='question_gap_bridge'`, `mode='targeted_question_fill'`
   - `learning_field_filter=<lf_id>`, `gap_class='QUESTION_GAP_ONLY'`
3. `fn_auto_dispatch_question_gap_bridge()` Bulk via Cron 243 (`*/30`), WIP-Cap 8 Pakete/Run, sortiert nach SUM(question_deficit).

## Idempotenz / Dedup
- `idempotency_key='qgap_bridge:<pkg>:<lf>:<YYYYMMDDHH>'` (1 Job pro Paket × LF × Stunde).
- Skip wenn bereits aktiver `package_repair_exam_pool_lf_coverage` Job mit gleichem `learning_field_filter` läuft.

## Phantom-Guard Whitelist
`claim_pending_jobs_by_types` erweitert um:
- `_origin='question_gap_bridge'`
- `mode='targeted_question_fill'`
- `enqueue_source='question_gap_bridge'` (payload + meta)
Sonst würde `STEP_ALREADY_DONE_PHANTOM` greifen (`generate_exam_pool` ist `done`).

## Audit
- `auto_heal_log.action_type='question_gap_bridge_dispatch'` (per Paket).
- `auto_heal_log.action_type='question_gap_bridge_bulk_run'` (per Cron-Tick).

## Cron
- 243 `question-gap-bridge-30min` `*/30 * * * *`.

## Smoke (2026-05-15)
- 8 Pakete dispatched, ~95 LF-Jobs enqueued, 0 skipped.
- Cron 242 (Variant-Approval-Bridge) läuft parallel.

## Nicht
- Kein Blueprint-/Variant-Reenqueue.
- Keine Threshold-Senkung.
- Keine Wirkung auf VARIANT_GAP / NO_MATERIAL Klassen.
