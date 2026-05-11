
-- ============================================================
-- SEO Alert Drilldown RPCs (Heal Cockpit · SEO Card Step 2)
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_get_seo_alert_log(p_limit int DEFAULT 50)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  result_status text,
  alerts_emitted int,
  rows jsonb,
  metadata jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.created_at,
    l.result_status,
    COALESCE((l.metadata ->> 'alerts_emitted')::int, 0) AS alerts_emitted,
    COALESCE(l.metadata -> 'rows', '[]'::jsonb)        AS rows,
    l.metadata
  FROM public.auto_heal_log l
  WHERE l.action_type = 'seo_job_health_alert'
    AND public.has_role(auth.uid(), 'admin')
  ORDER BY l.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
$$;

REVOKE ALL ON FUNCTION public.admin_get_seo_alert_log(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_seo_alert_log(int) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_get_seo_alert_log(int) IS
  'Heal-Cockpit · SEO Card Step 2: recent seo_job_health_alert audit entries. Admin-gated.';

-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_get_seo_jobs_drilldown(
  p_job_type text,
  p_window_minutes int DEFAULT 60,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  status text,
  attempts int,
  last_error_code text,
  last_error text,
  created_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  age_seconds int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    j.id,
    j.status::text,
    COALESCE(j.attempts, 0) AS attempts,
    j.last_error_code,
    LEFT(COALESCE(j.last_error, ''), 500) AS last_error,
    j.created_at,
    j.started_at,
    j.completed_at,
    GREATEST(0, EXTRACT(EPOCH FROM (now() - COALESCE(j.completed_at, j.started_at, j.created_at)))::int) AS age_seconds
  FROM public.job_queue j
  WHERE j.job_type = p_job_type
    AND COALESCE(j.completed_at, j.started_at, j.created_at)
        > now() - (GREATEST(1, LEAST(COALESCE(p_window_minutes, 60), 1440)) || ' minutes')::interval
    AND public.has_role(auth.uid(), 'admin')
  ORDER BY
    CASE j.status::text
      WHEN 'processing' THEN 0
      WHEN 'pending'    THEN 1
      WHEN 'failed'     THEN 2
      WHEN 'cancelled'  THEN 3
      ELSE 4
    END,
    COALESCE(j.completed_at, j.started_at, j.created_at) DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
$$;

REVOKE ALL ON FUNCTION public.admin_get_seo_jobs_drilldown(text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_seo_jobs_drilldown(text, int, int) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_get_seo_jobs_drilldown(text, int, int) IS
  'Heal-Cockpit · SEO Card Step 2: per-job_type drilldown (recent jobs incl. status & last_error). Admin-gated.';
