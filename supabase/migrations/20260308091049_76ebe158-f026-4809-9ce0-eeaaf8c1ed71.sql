
-- Fix: align assert_pipeline_status_integrity() job_status SSOT to actual live values
-- Live reality: completed, cancelled, failed, pending, processing, queued, dead, skipped
CREATE OR REPLACE FUNCTION public.assert_pipeline_status_integrity()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invalid_steps integer := 0;
  v_invalid_jobs integer := 0;
BEGIN
  SELECT count(*) INTO v_invalid_steps
  FROM public.package_steps
  WHERE status NOT IN ('queued','enqueued','running','done','failed','blocked','timeout','skipped');

  SELECT count(*) INTO v_invalid_jobs
  FROM public.job_queue
  WHERE status NOT IN ('queued','pending','processing','completed','done','failed','dead','cancelled','skipped');

  RETURN jsonb_build_object(
    'ok', (v_invalid_steps = 0 AND v_invalid_jobs = 0),
    'invalid_step_status_rows', v_invalid_steps,
    'invalid_job_status_rows', v_invalid_jobs,
    'step_status_ssot', jsonb_build_array('queued','enqueued','running','done','failed','blocked','timeout','skipped'),
    'job_status_ssot', jsonb_build_array('queued','pending','processing','completed','done','failed','dead','cancelled','skipped')
  );
END;
$$;
