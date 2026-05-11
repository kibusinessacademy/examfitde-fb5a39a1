-- Cleanup: reclassify integrity-check jobs stuck in 'processing' at handler_done
-- Root cause: Worker returned ok:true with integrity_passed=false in nested report,
-- runner marked completed → trg_job_complete_reconcile_step wrote step.status='done'
-- → fn_guard_governance_step_finalization RAISED EXCEPTION → entire UPDATE rolled back.
-- Patched in v2 (top-level integrity_passed signal + runner gate-routing + CAS).
-- Audit each reclassification.

WITH stuck AS (
  SELECT j.id, j.package_id, j.job_type, j.last_heartbeat_at,
         (j.meta->>'last_stage') AS last_stage,
         (j.meta->>'heartbeat_tick_count')::int AS ticks,
         cp.integrity_passed,
         cp.integrity_report
  FROM public.job_queue j
  LEFT JOIN public.course_packages cp ON cp.id = j.package_id
  WHERE j.job_type = 'package_run_integrity_check'
    AND j.status = 'processing'
    AND (j.meta->>'last_stage') = 'handler_done'
    AND j.last_heartbeat_at < now() - interval '30 seconds'
),
audited AS (
  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, trigger_source, result_status, result_detail, metadata)
  SELECT
    'integrity_handler_done_reclassify',
    'job',
    s.id,
    'manual_v2_runner_patch_cleanup',
    'success',
    format('Reclassified processing→%s (handler_done, ticks=%s, integrity_passed=%s)',
           CASE WHEN s.integrity_passed THEN 'completed' ELSE 'failed' END,
           s.ticks, s.integrity_passed),
    jsonb_build_object(
      'job_id', s.id,
      'package_id', s.package_id,
      'last_stage', s.last_stage,
      'heartbeat_tick_count', s.ticks,
      'integrity_passed', s.integrity_passed,
      'integrity_score', (s.integrity_report->>'score')
    )
  FROM stuck s
  RETURNING target_id
)
UPDATE public.job_queue j
SET status = CASE WHEN cp.integrity_passed THEN 'completed' ELSE 'failed' END,
    completed_at = now(),
    last_error = CASE WHEN cp.integrity_passed THEN NULL ELSE 'QUALITY_THRESHOLD_NOT_MET' END,
    locked_at = NULL,
    locked_by = NULL,
    meta = COALESCE(j.meta, '{}'::jsonb) || jsonb_build_object(
      'reclassified_by', 'v2_runner_patch_cleanup',
      'reclassified_at', now(),
      'last_error_code', CASE WHEN cp.integrity_passed THEN NULL ELSE 'QUALITY_THRESHOLD_NOT_MET' END
    )
FROM public.course_packages cp
WHERE j.id IN (SELECT id FROM stuck)
  AND cp.id = j.package_id
  AND j.status = 'processing';