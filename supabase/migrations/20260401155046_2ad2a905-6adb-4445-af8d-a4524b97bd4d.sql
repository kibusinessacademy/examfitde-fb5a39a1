
-- Reconciliation function for stale integrity reports
CREATE OR REPLACE FUNCTION public.fn_reconcile_stale_integrity_reports()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pkg record;
  v_requeued int := 0;
  v_skipped int := 0;
  v_has_active_job boolean;
  v_step_status text;
  v_last_requeue timestamptz;
BEGIN
  FOR pkg IN
    SELECT cp.id, cp.curriculum_id, cp.status
    FROM course_packages cp
    WHERE cp.status IN ('building', 'blocked', 'quality_gate_failed')
      AND cp.integrity_passed = false
    ORDER BY cp.priority ASC, cp.updated_at ASC
    LIMIT 5
  LOOP
    -- Check current step status
    SELECT ps.status,
           (ps.meta->>'integrity_reconcile_at')::timestamptz
    INTO v_step_status, v_last_requeue
    FROM package_steps ps
    WHERE ps.package_id = pkg.id
      AND ps.step_key = 'run_integrity_check';

    -- Skip if step is actively running
    IF v_step_status IN ('running', 'processing') THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Debounce: skip if requeued in last 10 minutes
    IF v_last_requeue IS NOT NULL AND v_last_requeue > now() - interval '10 minutes' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Check if there's already an active integrity job
    SELECT EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = pkg.id
        AND jq.job_type = 'package_run_integrity_check'
        AND jq.status IN ('pending', 'queued', 'processing')
    ) INTO v_has_active_job;

    IF v_has_active_job THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Step exists but is done/failed/blocked with stale report → requeue
    IF v_step_status IS NOT NULL AND v_step_status NOT IN ('queued') THEN
      UPDATE package_steps
      SET status = 'queued',
          started_at = NULL,
          finished_at = NULL,
          last_error = NULL,
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'integrity_reconcile_at', now()::text,
            'reconcile_reason', 'stale_integrity_report_auto_requeue',
            'previous_step_status', v_step_status
          )
      WHERE package_id = pkg.id
        AND step_key = 'run_integrity_check';
    ELSIF v_step_status = 'queued' THEN
      -- Already queued but no job → update meta for tracking
      UPDATE package_steps
      SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'integrity_reconcile_at', now()::text,
            'reconcile_reason', 'orphan_queued_without_job'
          )
      WHERE package_id = pkg.id
        AND step_key = 'run_integrity_check';
    END IF;

    v_requeued := v_requeued + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'requeued', v_requeued,
    'skipped', v_skipped,
    'run_at', now()::text
  );
END;
$$;
