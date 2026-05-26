CREATE OR REPLACE FUNCTION public.admin_get_background_agent_schedules()
RETURNS TABLE (
  workflow_type text,
  jobid         bigint,
  jobname       text,
  schedule      text,
  active        boolean,
  last_run_at   timestamptz,
  last_status   text,
  intent_count_24h bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_caller, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  RETURN QUERY
  WITH mapping AS (
    SELECT j.jobid, j.jobname, j.schedule, j.active,
      CASE
        WHEN j.jobname ILIKE 'seo-%'         THEN 'seo_opportunity'
        WHEN j.jobname ILIKE '%azav%'
          OR j.jobname ILIKE '%compliance%'  THEN 'compliance_drift'
        WHEN j.jobname ILIKE '%council%'
          OR j.jobname ILIKE '%quality%'
          OR j.jobname ILIKE '%heal%'
          OR j.jobname ILIKE '%repair%'
          OR j.jobname ILIKE '%integrity%'
          OR j.jobname ILIKE '%drift%'       THEN 'operational_quality'
        ELSE NULL
      END AS workflow_type
    FROM cron.job j
  ),
  last_run AS (
    SELECT jrd.jobid,
           MAX(jrd.start_time) AS last_run_at,
           (ARRAY_AGG(jrd.status ORDER BY jrd.start_time DESC))[1] AS last_status
    FROM cron.job_run_details jrd
    WHERE jrd.start_time > now() - interval '7 days'
    GROUP BY jrd.jobid
  ),
  intents AS (
    SELECT
      CASE
        WHEN si.intent_type ILIKE '%seo%'        THEN 'seo_opportunity'
        WHEN si.intent_type ILIKE '%compliance%'
          OR si.intent_type ILIKE '%azav%'       THEN 'compliance_drift'
        ELSE 'operational_quality'
      END AS workflow_type,
      COUNT(*) AS cnt
    FROM public.system_intents si
    WHERE si.created_at > now() - interval '24 hours'
    GROUP BY 1
  )
  SELECT
    m.workflow_type::text,
    m.jobid::bigint,
    m.jobname::text,
    m.schedule::text,
    m.active::boolean,
    lr.last_run_at,
    lr.last_status::text,
    COALESCE((SELECT i.cnt FROM intents i WHERE i.workflow_type = m.workflow_type), 0)::bigint
  FROM mapping m
  LEFT JOIN last_run lr ON lr.jobid = m.jobid
  WHERE m.workflow_type IS NOT NULL
  ORDER BY m.workflow_type, m.jobname;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_background_agent_schedules() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_background_agent_schedules() TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_get_background_agent_schedules() IS
'P72 — Read-only SSOT view over cron.job + cron.job_run_details + system_intents. Maps existing schedules to the 3 customer-facing background workflows. No new tables, no new runtime, no mutation. Admin-gated.';