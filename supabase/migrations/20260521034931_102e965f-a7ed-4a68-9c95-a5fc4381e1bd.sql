-- ─────────────────────────────────────────────────────────────
-- Fail Cluster Delta SSOT (Observability Mini-Card)
-- ─────────────────────────────────────────────────────────────

-- Cluster classifier (pure, immutable)
CREATE OR REPLACE FUNCTION public.fn_classify_fail_cluster(
  _job_type text,
  _error text,
  _last_error text,
  _last_error_code text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(_last_error_code,'') IN ('LF_REPAIR_RESCHEDULE_LOCK','NO_JOBS_DISPATCHED','ACTIVE_FANOUT_FOR_LF')
      OR COALESCE(_error,_last_error,'') ~* '(no_jobs_dispatched|active_fanout_for_lf|lf_repair_reschedule_lock)'
      THEN 'lf_self_fail'
    WHEN COALESCE(_last_error_code,'') = 'MISSING_BLUEPRINT_ID'
      OR COALESCE(_error,_last_error,'') ~* 'missing.?blueprint.?id'
      THEN 'missing_blueprint_id'
    WHEN COALESCE(_error,_last_error,'') ~* '(google_ai_api_key|invalid model id|gemini api key)'
      THEN 'ai_gateway_bypass'
    WHEN COALESCE(_last_error_code,'') = 'PRE_HEARTBEAT_KILL_TERMINAL'
      OR COALESCE(_error,_last_error,'') ~* 'was killed \(was killed'
      THEN 'phk_nested_kill'
    WHEN COALESCE(_last_error_code,'') = 'SEALED_COURSE'
      OR COALESCE(_error,_last_error,'') ~* 'sealed_course'
      THEN 'sealed_course_retry'
    WHEN COALESCE(_error,_last_error,'') ~* 'http\s*5\d\d|status\s*5\d\d|internal server error'
      THEN 'generic_http_500'
    ELSE NULL
  END;
$$;

-- Sanitize sample errors (strip secrets, trim)
CREATE OR REPLACE FUNCTION public.fn_sanitize_error_sample(_msg text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LEFT(
    regexp_replace(
      regexp_replace(
        regexp_replace(COALESCE(_msg,''), '(sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_.-]{20,}|Bearer\s+[A-Za-z0-9_.-]+)', '[REDACTED]', 'gi'),
        '([A-Z0-9_]*API[_]?KEY[A-Z0-9_]*\s*[:=]\s*)\S+', '\1[REDACTED]', 'gi'
      ),
      '\s+', ' ', 'g'
    ),
    240
  );
$$;

-- View: per-cluster aggregates
CREATE OR REPLACE VIEW public.v_admin_fail_cluster_delta AS
WITH classified AS (
  SELECT
    public.fn_classify_fail_cluster(job_type, error, last_error, last_error_code) AS cluster_key,
    error,
    last_error,
    COALESCE(updated_at, completed_at, created_at) AS event_at
  FROM public.job_queue
  WHERE status = 'failed'
    AND COALESCE(updated_at, completed_at, created_at) > now() - interval '5 days'
),
labeled AS (
  SELECT * FROM classified WHERE cluster_key IS NOT NULL
)
SELECT
  cluster_key,
  CASE cluster_key
    WHEN 'lf_self_fail'         THEN 'LF Self-Fail'
    WHEN 'missing_blueprint_id' THEN 'Missing Blueprint ID'
    WHEN 'ai_gateway_bypass'    THEN 'AI Gateway Bypass'
    WHEN 'phk_nested_kill'      THEN 'PHK Nested Kill'
    WHEN 'sealed_course_retry'  THEN 'Sealed Course Retry'
    WHEN 'generic_http_500'     THEN 'Generic HTTP 5xx'
  END AS label,
  COUNT(*) FILTER (WHERE event_at > now() - interval '24 hours')::int AS count_24h,
  COUNT(*)::int AS count_5d,
  MAX(event_at) AS last_seen,
  public.fn_sanitize_error_sample(
    (ARRAY_AGG(COALESCE(error,last_error) ORDER BY event_at DESC))[1]
  ) AS sample_error
FROM labeled
GROUP BY cluster_key;

REVOKE ALL ON public.v_admin_fail_cluster_delta FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_admin_fail_cluster_delta TO service_role;

-- Admin RPC (gated by has_role)
CREATE OR REPLACE FUNCTION public.admin_get_fail_cluster_delta()
RETURNS TABLE (
  cluster_key text,
  label text,
  count_24h int,
  count_5d int,
  delta int,
  status text,
  last_seen timestamptz,
  sample_error text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH all_clusters AS (
    SELECT * FROM (VALUES
      ('lf_self_fail',         'LF Self-Fail'),
      ('missing_blueprint_id', 'Missing Blueprint ID'),
      ('ai_gateway_bypass',    'AI Gateway Bypass'),
      ('phk_nested_kill',      'PHK Nested Kill'),
      ('sealed_course_retry',  'Sealed Course Retry'),
      ('generic_http_500',     'Generic HTTP 5xx')
    ) AS t(cluster_key, label)
  )
  SELECT
    a.cluster_key::text,
    a.label::text,
    COALESCE(v.count_24h, 0)::int AS count_24h,
    COALESCE(v.count_5d, 0)::int AS count_5d,
    (COALESCE(v.count_24h,0) - GREATEST((COALESCE(v.count_5d,0) - COALESCE(v.count_24h,0)) / 4, 0))::int AS delta,
    CASE
      WHEN COALESCE(v.count_24h,0) = 0 THEN 'green'
      WHEN COALESCE(v.count_24h,0) >= 10
        OR COALESCE(v.count_24h,0) > GREATEST((COALESCE(v.count_5d,0) - COALESCE(v.count_24h,0)) / 4, 0) * 2
        THEN 'critical'
      ELSE 'watch'
    END::text AS status,
    v.last_seen,
    v.sample_error
  FROM all_clusters a
  LEFT JOIN public.v_admin_fail_cluster_delta v USING (cluster_key)
  ORDER BY
    CASE
      WHEN COALESCE(v.count_24h,0) = 0 THEN 2
      WHEN COALESCE(v.count_24h,0) >= 10 THEN 0
      ELSE 1
    END,
    COALESCE(v.count_24h, 0) DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_fail_cluster_delta() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_fail_cluster_delta() TO authenticated, service_role;