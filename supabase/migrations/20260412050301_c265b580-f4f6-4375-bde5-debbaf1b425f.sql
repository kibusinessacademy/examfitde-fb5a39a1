
-- Fix: Cancel zombie jobs that can never do useful work because step meta already shows completion.
-- These jobs are stuck in pending/processing with BUDGET_EXHAUSTED, preventing FINALIZATION_RULES from firing.

-- 1) Cancel zombie minichecks jobs (remaining_targets_after = 0)
UPDATE job_queue jq
SET status = 'failed',
    last_error = 'ZOMBIE_CLEANUP: step meta shows remaining=0, job is no-op — cancelled to unblock finalization',
    locked_at = NULL,
    locked_by = NULL,
    updated_at = now()
FROM package_steps ps
WHERE ps.step_key = 'generate_lesson_minichecks'
  AND jq.payload->>'package_id' = ps.package_id::text
  AND jq.job_type = 'package_generate_lesson_minichecks'
  AND jq.status IN ('pending', 'processing')
  AND coalesce((ps.meta->>'remaining_targets_after')::int, -1) = 0;

-- 2) Cancel zombie handbook jobs (ok=true AND batch_complete=true)
UPDATE job_queue jq
SET status = 'failed',
    last_error = 'ZOMBIE_CLEANUP: step meta shows ok+batch_complete=true, job is no-op — cancelled to unblock finalization',
    locked_at = NULL,
    locked_by = NULL,
    updated_at = now()
FROM package_steps ps
WHERE ps.step_key = 'generate_handbook'
  AND jq.payload->>'package_id' = ps.package_id::text
  AND jq.job_type = 'package_generate_handbook'
  AND jq.status IN ('pending', 'processing')
  AND ps.meta->>'ok' = 'true'
  AND ps.meta->>'batch_complete' = 'true';

-- 3) Systemic guard: cron-callable function that auto-cancels no-op zombie jobs
-- Prevents future deadlocks where completed steps have lingering active jobs
CREATE OR REPLACE FUNCTION public.fn_cancel_zombie_noop_jobs()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cancelled int := 0;
  r record;
BEGIN
  -- MiniCheck zombies: remaining=0 but jobs still active
  FOR r IN
    SELECT jq.id as job_id, ps.package_id, jq.job_type
    FROM package_steps ps
    JOIN job_queue jq ON jq.payload->>'package_id' = ps.package_id::text
      AND jq.job_type = 'package_generate_lesson_minichecks'
      AND jq.status IN ('pending', 'processing')
    WHERE ps.step_key = 'generate_lesson_minichecks'
      AND coalesce((ps.meta->>'remaining_targets_after')::int, -1) = 0
      AND ps.status NOT IN ('done', 'skipped')
  LOOP
    UPDATE job_queue SET
      status = 'failed',
      last_error = 'ZOMBIE_NOOP_GUARD: step meta remaining=0, cancelling to unblock finalization',
      locked_at = NULL, locked_by = NULL, updated_at = now()
    WHERE id = r.job_id;
    cancelled := cancelled + 1;

    INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('zombie_noop_cancel', 'fn_cancel_zombie_noop_jobs', 'job_queue', r.job_id, 'applied',
            'Cancelled no-op job: step remaining=0',
            jsonb_build_object('package_id', r.package_id, 'job_type', r.job_type));
  END LOOP;

  -- Handbook zombies: ok+batch_complete=true but jobs still active
  FOR r IN
    SELECT jq.id as job_id, ps.package_id, jq.job_type
    FROM package_steps ps
    JOIN job_queue jq ON jq.payload->>'package_id' = ps.package_id::text
      AND jq.job_type = 'package_generate_handbook'
      AND jq.status IN ('pending', 'processing')
    WHERE ps.step_key = 'generate_handbook'
      AND ps.meta->>'ok' = 'true'
      AND ps.meta->>'batch_complete' = 'true'
      AND ps.status NOT IN ('done', 'skipped')
  LOOP
    UPDATE job_queue SET
      status = 'failed',
      last_error = 'ZOMBIE_NOOP_GUARD: step meta ok+batch_complete=true, cancelling to unblock finalization',
      locked_at = NULL, locked_by = NULL, updated_at = now()
    WHERE id = r.job_id;
    cancelled := cancelled + 1;

    INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
    VALUES ('zombie_noop_cancel', 'fn_cancel_zombie_noop_jobs', 'job_queue', r.job_id, 'applied',
            'Cancelled no-op job: step ok+batch_complete=true',
            jsonb_build_object('package_id', r.package_id, 'job_type', r.job_type));
  END LOOP;

  RETURN cancelled;
END;
$$;
