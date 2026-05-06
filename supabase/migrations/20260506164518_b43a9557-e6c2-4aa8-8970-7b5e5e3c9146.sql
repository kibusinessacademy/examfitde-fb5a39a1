CREATE OR REPLACE FUNCTION public.admin_get_producer_noise_trend(p_minutes int DEFAULT 60)
RETURNS TABLE(
  bucket_minute timestamptz,
  action_type text,
  producer text,
  job_type text,
  n bigint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    date_trunc('minute', l.created_at - (extract(minute from l.created_at)::int % 5) * interval '1 minute') AS bucket_minute,
    l.action_type,
    coalesce(l.metadata->>'producer','unknown') AS producer,
    coalesce(l.metadata->>'job_type','-') AS job_type,
    count(*) AS n
  FROM public.auto_heal_log l
  WHERE l.created_at > now() - make_interval(mins => greatest(p_minutes,5))
    AND l.action_type IN (
      'producer_blocked_package_progress',
      'producer_precheck_skip',
      'ssot_payload_warn',
      'cluster_heal_nudge_2026_05_06'
    )
    AND public.has_role(auth.uid(),'admin'::app_role)
  GROUP BY 1,2,3,4
  ORDER BY 1 DESC, n DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_get_producer_noise_trend(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_producer_noise_trend(int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_producer_noise_anomalies(p_minutes int DEFAULT 60)
RETURNS TABLE(
  action_type text,
  producer text,
  recent_n bigint,
  prior_n bigint,
  ratio numeric,
  severity text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH recent AS (
    SELECT action_type, coalesce(metadata->>'producer','unknown') AS producer, count(*) AS n
    FROM public.auto_heal_log
    WHERE created_at > now() - make_interval(mins => p_minutes)
      AND action_type IN ('producer_blocked_package_progress','producer_precheck_skip','ssot_payload_warn')
    GROUP BY 1,2
  ),
  prior AS (
    SELECT action_type, coalesce(metadata->>'producer','unknown') AS producer, count(*) AS n
    FROM public.auto_heal_log
    WHERE created_at > now() - make_interval(mins => p_minutes*2)
      AND created_at <= now() - make_interval(mins => p_minutes)
      AND action_type IN ('producer_blocked_package_progress','producer_precheck_skip','ssot_payload_warn')
    GROUP BY 1,2
  )
  SELECT
    r.action_type,
    r.producer,
    r.n AS recent_n,
    coalesce(p.n,0) AS prior_n,
    round(r.n::numeric / nullif(coalesce(p.n,0),0), 2) AS ratio,
    CASE
      WHEN r.n >= 20 AND coalesce(p.n,0) = 0 THEN 'critical'
      WHEN r.n >= 20 AND r.n::numeric / nullif(p.n,0) > 5 THEN 'critical'
      WHEN r.n >= 10 AND r.n::numeric / nullif(p.n,0) > 2 THEN 'warning'
      ELSE 'info'
    END AS severity
  FROM recent r
  LEFT JOIN prior p USING (action_type, producer)
  WHERE public.has_role(auth.uid(),'admin'::app_role)
    AND r.n >= 10
    AND (coalesce(p.n,0) = 0 OR r.n::numeric / nullif(p.n,0) > 2)
  ORDER BY severity DESC, recent_n DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_get_producer_noise_anomalies(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_producer_noise_anomalies(int) TO authenticated;