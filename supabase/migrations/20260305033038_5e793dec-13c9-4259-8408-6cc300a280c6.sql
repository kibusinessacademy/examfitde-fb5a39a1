
-- Auto-revive RPC: reset lesson jobs that failed due to transient errors
-- Safe: only updates failed→pending (no INSERT, no unique index conflict risk)
CREATE OR REPLACE FUNCTION public.revive_transient_failed_lesson_jobs(p_limit int DEFAULT 200)
RETURNS TABLE (job_id uuid, package_id uuid, prev_attempts int, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT jq.id, jq.package_id, jq.attempts,
           COALESCE(jq.last_error, '') AS err
    FROM public.job_queue jq
    WHERE jq.job_type = 'lesson_generate_content'
      AND jq.status = 'failed'
      AND (
        LOWER(COALESCE(jq.last_error, '')) LIKE '%timed out%'
        OR LOWER(COALESCE(jq.last_error, '')) LIKE '%timeout%'
        OR LOWER(COALESCE(jq.last_error, '')) LIKE '%all providers failed%'
        OR LOWER(COALESCE(jq.last_error, '')) LIKE '%fetch failed%'
        OR LOWER(COALESCE(jq.last_error, '')) LIKE '%network%'
        OR LOWER(COALESCE(jq.last_error, '')) LIKE '%rate limit%'
        OR LOWER(COALESCE(jq.last_error, '')) LIKE '%429%'
        OR LOWER(COALESCE(jq.last_error, '')) LIKE '%503%'
        OR LOWER(COALESCE(jq.last_error, '')) LIKE '%transient%'
      )
    ORDER BY jq.updated_at DESC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.job_queue jq
    SET status = 'pending',
        attempts = 0,
        run_after = NOW() + INTERVAL '5 minutes',
        locked_by = NULL,
        locked_at = NULL,
        last_error = NULL,
        updated_at = NOW(),
        meta = COALESCE(jq.meta, '{}'::jsonb) ||
          jsonb_build_object(
            'auto_revived', true,
            'auto_revived_at', NOW()::text,
            'prev_attempts', jq.attempts
          )
    FROM candidates c
    WHERE jq.id = c.id
    RETURNING jq.id, jq.package_id, c.attempts AS prev_attempts
  )
  SELECT u.id, u.package_id, u.prev_attempts, 'transient_failed'::text
  FROM updated u;
END;
$$;

-- Restrict to service role
REVOKE ALL ON FUNCTION public.revive_transient_failed_lesson_jobs(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revive_transient_failed_lesson_jobs(int) FROM anon;
REVOKE ALL ON FUNCTION public.revive_transient_failed_lesson_jobs(int) FROM authenticated;
