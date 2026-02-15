
-- ============================================================
-- 1) Package State Machine: claim_next_job enforces step order
-- ============================================================
-- Map each job_type to the required package build_step 
-- so no step runs out-of-order.

CREATE TABLE IF NOT EXISTS public.pipeline_step_order (
  job_type text PRIMARY KEY,
  required_package_step text NOT NULL,
  step_index int NOT NULL DEFAULT 0
);

INSERT INTO public.pipeline_step_order (job_type, required_package_step, step_index) VALUES
  ('package_scaffold_learning_course', 'scaffold_learning_course', 1),
  ('package_generate_exam_pool',       'generate_exam_pool',       2),
  ('package_generate_oral_exam',       'generate_oral_exam',       3),
  ('package_build_ai_tutor_index',     'build_ai_tutor_index',     4),
  ('package_generate_handbook',        'generate_handbook',        5),
  ('package_run_integrity_check',      'run_integrity_check',      6),
  ('package_quality_council',          'quality_council',          7),
  ('package_auto_publish',             'auto_publish',             8)
ON CONFLICT (job_type) DO NOTHING;

-- Updated claim_next_job: checks jobtype_limits + step order
CREATE OR REPLACE FUNCTION public.claim_next_job(p_worker_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.job_queue%ROWTYPE;
  v_limit int;
  v_processing int;
  v_required_step text;
  v_step_index int;
  v_current_step text;
  v_current_index int;
BEGIN
  -- pick next pending job
  SELECT *
  INTO v_job
  FROM public.job_queue
  WHERE status = 'pending'
    AND locked_at IS NULL
    AND run_after <= now()
    AND attempts < max_attempts
  ORDER BY priority DESC, run_after ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_job.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- ── Step-Order Guard ──
  SELECT required_package_step, step_index
  INTO v_required_step, v_step_index
  FROM public.pipeline_step_order
  WHERE job_type = v_job.job_type;

  IF v_required_step IS NOT NULL AND v_job.payload IS NOT NULL THEN
    -- Get current package step
    SELECT cp.current_step
    INTO v_current_step
    FROM public.course_packages cp
    WHERE cp.id = (v_job.payload->>'package_id')::uuid;

    IF v_current_step IS NOT NULL THEN
      SELECT step_index INTO v_current_index
      FROM public.pipeline_step_order
      WHERE required_package_step = v_current_step;

      -- If package hasn't reached prior step yet, defer
      IF v_current_index IS NOT NULL AND v_current_index < (v_step_index - 1) THEN
        UPDATE public.job_queue
        SET run_after = now() + interval '2 minutes',
            updated_at = now()
        WHERE id = v_job.id;
        RETURN NULL;
      END IF;
    END IF;
  END IF;

  -- ── Jobtype Concurrency Limit ──
  SELECT max_processing INTO v_limit
  FROM public.jobtype_limits
  WHERE job_type = v_job.job_type;

  IF v_limit IS NULL THEN
    v_limit := 2;
  END IF;

  SELECT count(*) INTO v_processing
  FROM public.job_queue
  WHERE status = 'processing'
    AND job_type = v_job.job_type;

  IF v_processing >= v_limit THEN
    UPDATE public.job_queue
    SET run_after = now() + interval '30 seconds',
        updated_at = now()
    WHERE id = v_job.id;
    RETURN NULL;
  END IF;

  -- ── Claim ──
  UPDATE public.job_queue
  SET
    status = 'processing',
    locked_at = now(),
    locked_by = p_worker_id,
    attempts = attempts + 1,
    started_at = COALESCE(started_at, now()),
    updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN to_jsonb(v_job);
END;
$$;

-- ============================================================
-- 2) Stale-Lock Reaper: recover crashed processing jobs
-- ============================================================
CREATE OR REPLACE FUNCTION public.reap_stale_locks(p_max_age_minutes int DEFAULT 15)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reaped int;
BEGIN
  WITH stale AS (
    SELECT id
    FROM public.job_queue
    WHERE status = 'processing'
      AND locked_at < now() - (p_max_age_minutes || ' minutes')::interval
  )
  UPDATE public.job_queue jq
  SET
    status = CASE
      WHEN jq.attempts >= jq.max_attempts THEN 'failed'
      ELSE 'pending'
    END,
    locked_at = NULL,
    locked_by = NULL,
    run_after = now() + interval '1 minute',
    error_message = COALESCE(jq.error_message, '') || ' | STALE_LOCK_REAPED at ' || now()::text,
    updated_at = now()
  FROM stale
  WHERE jq.id = stale.id;

  GET DIAGNOSTICS v_reaped = ROW_COUNT;

  RETURN jsonb_build_object('reaped', v_reaped, 'max_age_minutes', p_max_age_minutes);
END;
$$;
