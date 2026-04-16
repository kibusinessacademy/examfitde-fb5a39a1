
-- SSOT Health Monitoring RPCs for Ops Dashboard

CREATE OR REPLACE FUNCTION public.fn_ssot_ghost_success_count()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT count(*)::int
  FROM package_steps
  WHERE (meta->>'ok')::boolean = true
    AND status NOT IN ('done', 'skipped');
$$;

CREATE OR REPLACE FUNCTION public.fn_ssot_job_step_drift_count()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT count(DISTINCT (ps.package_id, ps.step_key))::int
  FROM job_queue jq
  JOIN package_steps ps ON ps.package_id = jq.package_id
    AND ps.step_key = replace(jq.job_type, 'package_', '')
  WHERE jq.status = 'completed'
    AND ps.status NOT IN ('done', 'skipped')
    AND jq.updated_at > now() - interval '24 hours';
$$;

CREATE OR REPLACE FUNCTION public.fn_ssot_processing_leak_count()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT count(*)::int
  FROM job_queue
  WHERE status = 'processing'
    AND updated_at < now() - interval '15 minutes';
$$;

CREATE OR REPLACE FUNCTION public.fn_ssot_hard_fail_summary()
RETURNS TABLE(step_key text, cnt integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT ps.step_key, count(*)::int as cnt
  FROM package_steps ps
  JOIN course_packages cp ON cp.id = ps.package_id
  WHERE ps.status IN ('failed', 'blocked')
    AND ps.last_error LIKE '%HARD_FAIL%'
    AND cp.status NOT IN ('archived', 'cancelled')
  GROUP BY ps.step_key
  ORDER BY cnt DESC;
$$;

CREATE OR REPLACE FUNCTION public.fn_ssot_queued_without_jobs_count()
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT count(*)::int
  FROM package_steps ps
  JOIN course_packages cp ON cp.id = ps.package_id
  WHERE ps.status = 'queued'
    AND cp.status = 'building'
    AND NOT EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = ps.package_id
        AND jq.status IN ('pending', 'processing', 'queued')
        AND jq.job_type = 'package_' || ps.step_key
    );
$$;
