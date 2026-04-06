
-- Add zombie cleanup step to claim_pending_jobs_v4
-- We add a pre-claim step that cancels zombie jobs for non-building packages

CREATE OR REPLACE FUNCTION public.fn_cancel_zombie_jobs()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cancelled int;
  v_repair_whitelist text[] := ARRAY[
    'package_repair_exam_pool_quality',
    'package_exam_rebalance',
    'pool_fill_bloom_gaps',
    'pool_fill_lf_gaps',
    'pool_fill_trap_gaps',
    'package_run_integrity_check',
    'package_validate_exam_pool',
    'package_quality_council'
  ];
BEGIN
  WITH zombies AS (
    UPDATE job_queue jq
    SET status = 'cancelled',
        last_error = format('ZOMBIE_GUARD: package status is %s (not building)', cp.status),
        completed_at = now(),
        updated_at = now(),
        locked_at = NULL,
        locked_by = NULL
    FROM course_packages cp
    WHERE jq.package_id = cp.id
      AND jq.status = 'pending'
      AND cp.status NOT IN ('building')
      AND jq.job_type != ALL(v_repair_whitelist)
    RETURNING jq.id
  )
  SELECT count(*) INTO v_cancelled FROM zombies;

  IF v_cancelled > 0 THEN
    INSERT INTO system_heal_log (heal_type, package_id, step_key, details)
    VALUES ('zombie_guard_cleanup', NULL, NULL,
            jsonb_build_object('cancelled_count', v_cancelled));
  END IF;

  RETURN v_cancelled;
END;
$$;
