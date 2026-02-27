
-- RPC 1: cancel_jobs_for_package (deterministic, idempotent)
CREATE OR REPLACE FUNCTION public.cancel_jobs_for_package(
  p_package_id uuid,
  p_job_type text DEFAULT NULL,
  p_statuses text[] DEFAULT ARRAY['pending','failed'],
  p_reason text DEFAULT 'auto-heal: cancelled jobs for package'
)
RETURNS TABLE(cancelled_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cnt int;
BEGIN
  UPDATE public.job_queue jq
  SET
    status = 'cancelled',
    completed_at = now(),
    last_error = CASE
      WHEN jq.last_error IS NULL OR jq.last_error = '' THEN p_reason
      ELSE jq.last_error || ' | ' || p_reason
    END
  WHERE
    jq.status = ANY(p_statuses)
    AND (p_job_type IS NULL OR jq.job_type = p_job_type)
    AND (jq.payload->>'package_id')::uuid = p_package_id;

  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  cancelled_count := v_cnt;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_jobs_for_package(uuid,text,text[],text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_jobs_for_package(uuid,text,text[],text) TO service_role;

-- RPC 2: cancel_stale_processing_jobs_for_package
CREATE OR REPLACE FUNCTION public.cancel_stale_processing_jobs_for_package(
  p_package_id uuid,
  p_job_type text DEFAULT NULL,
  p_stale_minutes int DEFAULT 15,
  p_reason text DEFAULT NULL
)
RETURNS TABLE(cancelled_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cnt int;
  v_reason text;
BEGIN
  v_reason := COALESCE(
    p_reason,
    'auto-heal: cancelled stale processing jobs (>' || p_stale_minutes || 'min)'
  );

  UPDATE public.job_queue jq
  SET
    status = 'cancelled',
    completed_at = now(),
    last_error = CASE
      WHEN jq.last_error IS NULL OR jq.last_error = '' THEN v_reason
      ELSE jq.last_error || ' | ' || v_reason
    END
  WHERE
    jq.status = 'processing'
    AND (p_job_type IS NULL OR jq.job_type = p_job_type)
    AND (jq.payload->>'package_id')::uuid = p_package_id
    AND COALESCE(jq.locked_at, jq.created_at) < now() - make_interval(mins => p_stale_minutes);

  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  cancelled_count := v_cnt;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_stale_processing_jobs_for_package(uuid,text,int,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_stale_processing_jobs_for_package(uuid,text,int,text) TO service_role;

-- Performance indexes
CREATE INDEX IF NOT EXISTS job_queue_payload_package_id_idx
ON public.job_queue (((payload->>'package_id')::uuid));

CREATE INDEX IF NOT EXISTS job_queue_status_jobtype_idx
ON public.job_queue (status, job_type);
