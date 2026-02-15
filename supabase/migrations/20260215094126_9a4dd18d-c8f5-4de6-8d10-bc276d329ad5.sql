-- FIX: claim_next_job must not claim jobs beyond max_attempts
-- and must return the UPDATED row (attempts increment visible to runner)

CREATE OR REPLACE FUNCTION public.claim_next_job(p_worker_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.job_queue%ROWTYPE;
BEGIN
  -- pick only claimable jobs (incl. attempts guard)
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

  -- claim + increment attempts and RETURNING updated row
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