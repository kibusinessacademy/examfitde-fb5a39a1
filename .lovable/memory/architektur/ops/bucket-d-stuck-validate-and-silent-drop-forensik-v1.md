# Memory: architektur/ops/bucket-d-stuck-validate-and-silent-drop-forensik-v1
Updated: now

## Bucket D: STUCK_VALIDATE_EXAM_POOL_BLOCKS_INTEGRITY

`v_stuck_validate_exam_pool_blocking_integrity` klassifiziert Pakete deren `validate_exam_pool` step queued bleibt, obwohl Upstream `done` und Pool ≥50 approved hat. Heal-Klassen: `WAIT_UPSTREAM_GEN`, `UPSTREAM_NOT_DONE`, `POOL_TOO_SMALL`, `WAIT_OBSERVE`, `ELIGIBLE_REQUEUE`.

`admin_reconcile_stuck_validate_exam_pool(p_limit, p_dry_run, p_package_id)` cancelt stale pending validate-Jobs (>15min, unstarted) und enqueuet frischen `package_validate_exam_pool` mit `_origin='stuck_validate_exam_pool_reconciler'` und `bronze_lock_override` falls bronze_locked. Service-role / admin gegated. Audit: `stuck_validate_exam_pool_reconcile_{dryrun,enqueued,error,summary}`. Baseline 2026-05-13: 4 Pakete ELIGIBLE_REQUEUE (Bürsten, Gold/Silber, Datenschutz TÜV, KEP).

## Generic Silent-Drop Forensik

`v_audit_enqueue_silent_drops` matcht jede `auto_heal_log`-Zeile mit `action_type LIKE '%_enqueued'` und `result_status='success'` gegen tatsächliche `job_queue`-Einträge (per `metadata.job_id` oder ±60s Zeitfenster auf package_id+job_type). Verdict: `PRESENT`, `PRESENT_BY_TIME_WINDOW`, `SILENT_DROP`.

`admin_get_audit_enqueue_silent_drops(p_window_minutes, p_action_type)` exposed für Cockpit/Smoke. `fn_check_audit_silent_drops_and_alert(p_window_minutes, p_threshold)` cron-fähig — schreibt P1-Alert in `heal_alert_notifications` (eindeutig pro Stunde via alert_key, Trigger-Dedupe hält Spam unten).

## fn_enforce_global_fanout_cap Mirror

BEFORE-INSERT-Guard `fn_enforce_global_fanout_cap` schreibt zusätzlich zu `ops_guardrail_events.fanout_cap_blocked` jetzt `auto_heal_log.action_type='job_queue_insert_suppressed_fanout_cap'` (target_type=package, result_status=skipped). BEGIN/EXCEPTION-safe.

## Repro-Test
`scripts/repro/audit-enqueue-silent-drop-repro.mjs` — dry-run sweep + forensik RPC + summary-vs-actual count cross-check. Exit 1 bei drift, exit 2 bei RPC-Fehler.
