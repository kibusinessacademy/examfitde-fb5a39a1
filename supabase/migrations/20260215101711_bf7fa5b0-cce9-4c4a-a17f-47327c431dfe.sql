
-- FIX: claim_next_job enforces jobtype_limits WIP cap per job type
-- Prevents 409/429 storms by limiting concurrent processing per type

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
BEGIN
  -- pick next claimable job (attempts guard enforced)
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

  -- enforce per-jobtype WIP limit from jobtype_limits table
  SELECT max_processing INTO v_limit
  FROM public.jobtype_limits
  WHERE job_type = v_job.job_type;

  IF v_limit IS NULL THEN
    v_limit := 2; -- sane default
  END IF;

  SELECT count(*) INTO v_processing
  FROM public.job_queue
  WHERE status = 'processing'
    AND job_type = v_job.job_type;

  IF v_processing >= v_limit THEN
    -- defer: push into future to avoid hot-loop polling
    UPDATE public.job_queue
      SET run_after = now() + interval '30 seconds',
          updated_at = now()
    WHERE id = v_job.id;
    RETURN NULL;
  END IF;

  -- claim + increment attempts, return UPDATED row
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
