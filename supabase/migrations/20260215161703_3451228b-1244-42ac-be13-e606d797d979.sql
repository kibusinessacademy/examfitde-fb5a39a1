
-- Auto-heal function: requeues failed exam_pool jobs stuck on PREREQ_RETRY_CAP_REACHED
CREATE OR REPLACE FUNCTION public.auto_heal_prereq_retry_cap_failures(p_limit int DEFAULT 200)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
BEGIN
  WITH candidates AS (
    SELECT j.id
    FROM public.job_queue j
    WHERE j.status = 'failed'
      AND j.error ILIKE '%PREREQ%'
      AND (j.payload ? 'package_id')
    ORDER BY j.updated_at DESC
    LIMIT p_limit
  )
  UPDATE public.job_queue j
  SET status = 'pending',
      attempts = 0,
      locked_at = NULL,
      locked_by = NULL,
      run_after = now() + interval '1 minute',
      error = COALESCE(j.error, '') || ' | AUTO_HEALED',
      updated_at = now()
  FROM candidates c
  WHERE j.id = c.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
