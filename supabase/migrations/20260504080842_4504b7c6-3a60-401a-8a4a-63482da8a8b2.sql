-- Recreate view with neutral column name (avoid reserved word "session_user")
DROP VIEW IF EXISTS public.v_enqueue_source_missing_callers_24h CASCADE;

CREATE VIEW public.v_enqueue_source_missing_callers_24h AS
SELECT
  COALESCE(NULLIF(payload->'_audit'->>'application_name', ''), 'unknown') AS application_name,
  COALESCE(NULLIF(payload->'_audit'->>'session_user', ''), 'unknown') AS caller_session_user,
  job_type,
  COUNT(*)::bigint AS warn_count,
  MIN(created_at) AS first_seen,
  MAX(created_at) AS last_seen,
  LEFT(MAX(payload->'_audit'->>'current_query'), 200) AS sample_query_snippet
FROM public.job_queue
WHERE created_at > now() - interval '24 hours'
  AND (payload->>'enqueue_source' IS NULL OR payload->>'enqueue_source' = '')
GROUP BY 1, 2, 3
ORDER BY warn_count DESC;

-- Lock down direct access
REVOKE ALL ON public.v_enqueue_source_missing_callers_24h FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_enqueue_source_missing_callers_24h TO service_role;

-- Recreate RPC with corrected column list and neutral naming
CREATE OR REPLACE FUNCTION public.admin_get_enqueue_source_missing_callers()
RETURNS TABLE(
  application_name text,
  caller_session_user text,
  job_type text,
  warn_count bigint,
  first_seen timestamptz,
  last_seen timestamptz,
  sample_query_snippet text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.application_name,
    v.caller_session_user,
    v.job_type,
    v.warn_count,
    v.first_seen,
    v.last_seen,
    v.sample_query_snippet
  FROM public.v_enqueue_source_missing_callers_24h v
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
     OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role';
$$;

REVOKE ALL ON FUNCTION public.admin_get_enqueue_source_missing_callers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_enqueue_source_missing_callers() TO service_role;