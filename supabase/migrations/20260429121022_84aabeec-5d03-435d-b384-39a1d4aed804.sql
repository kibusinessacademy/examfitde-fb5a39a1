CREATE OR REPLACE VIEW public.v_admin_lane_health AS
WITH active AS (
  SELECT COALESCE(lane,'unknown')::text AS lane,
    COUNT(*) FILTER (WHERE status='pending')::int    AS pending_cnt,
    COUNT(*) FILTER (WHERE status='processing')::int AS processing_cnt,
    COUNT(*) FILTER (WHERE status='queued')::int     AS queued_cnt,
    (MAX(EXTRACT(EPOCH FROM (now() - created_at))) FILTER (WHERE status IN ('pending','queued')))::int AS oldest_pending_sec
  FROM public.job_queue
  WHERE status IN ('pending','processing','queued')
  GROUP BY COALESCE(lane,'unknown')
),
done_stats AS (
  SELECT COALESCE(lane,'unknown')::text AS lane,
    MAX(completed_at) AS last_done_at,
    COUNT(*) FILTER (WHERE completed_at >= now() - interval '6 hours')::int AS done_6h
  FROM public.job_queue
  WHERE status='done'
  GROUP BY COALESCE(lane,'unknown')
)
SELECT a.lane, a.pending_cnt, a.processing_cnt, a.queued_cnt,
       d.last_done_at, COALESCE(d.done_6h,0) AS done_6h, a.oldest_pending_sec
FROM active a LEFT JOIN done_stats d USING (lane);
GRANT SELECT ON public.v_admin_lane_health TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_lane_health()
RETURNS SETOF public.v_admin_lane_health
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT * FROM public.v_admin_lane_health
  WHERE public.has_role(auth.uid(), 'admin'::app_role);
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_lane_health() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_cancel_reason_breakdown(p_hours integer DEFAULT 24)
RETURNS TABLE (job_type text, reason_code text, cnt bigint, pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH base AS (
    SELECT jq.job_type,
      COALESCE(NULLIF(SUBSTRING(COALESCE(jq.last_error,'') FROM '^([A-Z_][A-Z0-9_]+)'), ''),
               'UNCLASSIFIED') AS reason_code
    FROM public.job_queue jq
    WHERE jq.status = 'cancelled'
      AND COALESCE(jq.completed_at, jq.updated_at) >= now() - make_interval(hours => GREATEST(p_hours, 1))
      AND public.has_role(auth.uid(), 'admin'::app_role)
  ),
  agg AS (SELECT job_type, reason_code, COUNT(*)::bigint AS cnt FROM base GROUP BY job_type, reason_code),
  total AS (SELECT NULLIF(SUM(cnt),0) AS t FROM agg)
  SELECT a.job_type, a.reason_code, a.cnt,
         ROUND((a.cnt::numeric / COALESCE((SELECT t FROM total),1)) * 100, 1) AS pct
  FROM agg a ORDER BY a.cnt DESC LIMIT 100;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_cancel_reason_breakdown(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_pending_age_histogram()
RETURNS TABLE (bucket text, cnt bigint, oldest_sec int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH src AS (
    SELECT EXTRACT(EPOCH FROM (now() - jq.created_at))::int AS age_sec
    FROM public.job_queue jq
    WHERE jq.status IN ('pending','queued')
      AND public.has_role(auth.uid(), 'admin'::app_role)
  ),
  bucketed AS (
    SELECT CASE WHEN age_sec < 300 THEN '<5m'
                WHEN age_sec < 1800 THEN '5-30m'
                WHEN age_sec < 3600 THEN '30-60m'
                WHEN age_sec < 21600 THEN '1-6h'
                WHEN age_sec < 86400 THEN '6-24h'
                ELSE '>24h' END AS bucket,
           age_sec
    FROM src
  )
  SELECT bucket, COUNT(*)::bigint, MAX(age_sec)::int
  FROM bucketed GROUP BY bucket
  ORDER BY CASE bucket WHEN '<5m' THEN 1 WHEN '5-30m' THEN 2 WHEN '30-60m' THEN 3
                       WHEN '1-6h' THEN 4 WHEN '6-24h' THEN 5 ELSE 6 END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_pending_age_histogram() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_blocked_packages_detail()
RETURNS TABLE (package_id uuid, title text, blocked_at timestamptz,
               last_step text, last_error text, failed_jobs_24h int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT cp.id, cp.title, cp.updated_at,
    (SELECT cps.step_key FROM public.course_package_build_steps cps
      WHERE cps.package_id = cp.id ORDER BY cps.updated_at DESC NULLS LAST LIMIT 1),
    (SELECT jq.last_error FROM public.job_queue jq
      WHERE jq.package_id = cp.id AND jq.last_error IS NOT NULL
      ORDER BY jq.updated_at DESC LIMIT 1),
    (SELECT COUNT(*)::int FROM public.job_queue jq2
      WHERE jq2.package_id = cp.id AND jq2.status = 'failed'
        AND jq2.completed_at >= now() - interval '24 hours')
  FROM public.course_packages cp
  WHERE cp.status = 'blocked'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  ORDER BY cp.updated_at DESC LIMIT 100;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_blocked_packages_detail() TO authenticated;