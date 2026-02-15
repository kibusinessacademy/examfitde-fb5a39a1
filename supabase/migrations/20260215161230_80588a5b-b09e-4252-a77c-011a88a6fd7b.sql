
-- Fix: claim_next_job step-order guard must use package_steps (SSOT)
-- instead of course_packages.current_step (stale/soft).
-- This prevents out-of-order jobs from being claimed and burning retry caps.

CREATE OR REPLACE FUNCTION public.claim_next_job(p_worker_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_job public.job_queue%ROWTYPE;
  v_limit int;
  v_processing int;
  v_required_step text;
  v_step_index int;
  v_pkg_id uuid;
  v_prereq_step text;
  v_prereq_status text;
  v_own_step_status text;
BEGIN
  -- pick next pending job (atomic, skip locked)
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

  -- ── Step-Order Guard (SSOT: package_steps table) ──
  SELECT required_package_step, step_index
  INTO v_required_step, v_step_index
  FROM public.pipeline_step_order
  WHERE job_type = v_job.job_type;

  IF v_required_step IS NOT NULL
     AND v_job.payload IS NOT NULL
     AND (v_job.payload ? 'package_id') THEN

    v_pkg_id := (v_job.payload->>'package_id')::uuid;

    -- Check if this step is already done/skipped → skip duplicate job
    SELECT ps.status::text
    INTO v_own_step_status
    FROM public.package_steps ps
    WHERE ps.package_id = v_pkg_id
      AND ps.step_key = v_required_step;

    IF v_own_step_status IN ('done', 'skipped') THEN
      UPDATE public.job_queue
      SET status = 'cancelled',
          error = COALESCE(error, '') || ' | STEP_ALREADY_DONE:' || v_required_step,
          completed_at = now(),
          updated_at = now()
      WHERE id = v_job.id;
      RETURN NULL;
    END IF;

    -- Check prerequisite step (step_index - 1) status in package_steps
    IF v_step_index > 1 THEN
      SELECT pso.required_package_step
      INTO v_prereq_step
      FROM public.pipeline_step_order pso
      WHERE pso.step_index = v_step_index - 1;

      IF v_prereq_step IS NOT NULL THEN
        SELECT ps.status::text
        INTO v_prereq_status
        FROM public.package_steps ps
        WHERE ps.package_id = v_pkg_id
          AND ps.step_key = v_prereq_step;

        -- Prereq not done → defer WITHOUT burning an attempt
        IF COALESCE(v_prereq_status, 'pending') NOT IN ('done', 'skipped') THEN
          UPDATE public.job_queue
          SET run_after = now() + interval '2 minutes',
              updated_at = now()
          WHERE id = v_job.id;
          RETURN NULL;
        END IF;
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
