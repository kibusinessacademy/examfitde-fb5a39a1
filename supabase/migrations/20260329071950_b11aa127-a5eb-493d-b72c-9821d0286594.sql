
-- Add 'zombie_reaped' and 'ancient_reaped' to liveness_status check constraint
ALTER TABLE public.job_queue DROP CONSTRAINT job_queue_liveness_status_chk;
ALTER TABLE public.job_queue ADD CONSTRAINT job_queue_liveness_status_chk
  CHECK (liveness_status = ANY (ARRAY['healthy','suspect','killed','cooldown_exhausted','zombie_reaped','ancient_reaped']));

-- Fix the reaper function to use valid liveness_status
CREATE OR REPLACE FUNCTION public.reap_zombie_processing_jobs_v2(
  p_max_age_hours integer DEFAULT 24,
  p_reason text DEFAULT 'ZOMBIE_PROCESSING_TIMEOUT'
)
RETURNS TABLE (
  job_id uuid,
  package_id uuid,
  job_type text,
  age_hours numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH zombies AS (
    SELECT
      jq.id,
      jq.package_id,
      jq.job_type,
      ROUND(EXTRACT(EPOCH FROM (now() - jq.created_at)) / 3600.0, 1) AS age_h
    FROM public.job_queue jq
    WHERE jq.status = 'processing'
      AND jq.created_at < now() - make_interval(hours => p_max_age_hours)
  ),
  upd AS (
    UPDATE public.job_queue jq
    SET
      status = 'failed',
      liveness_status = 'zombie_reaped',
      last_error = left(COALESCE(jq.last_error, '') || ' | ' || p_reason, 1000),
      last_error_code = 'ZOMBIE_REAPER_V2',
      completed_at = now(),
      updated_at = now(),
      locked_at = NULL,
      locked_by = NULL,
      meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
        'zombie_reaped_at', now(),
        'zombie_age_hours', z.age_h,
        'zombie_reason', p_reason
      )
    FROM zombies z
    WHERE jq.id = z.id
    RETURNING jq.id, jq.package_id, jq.job_type, z.age_h
  )
  SELECT * FROM upd;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reap_zombie_processing_jobs_v2(integer, text) TO service_role;
