
-- RPC: get_org_performance_dashboard
-- Returns per-learner readiness, risk, and activity data for an org's seated users
CREATE OR REPLACE FUNCTION public.get_org_performance_dashboard(
  p_org_id uuid,
  p_product_id uuid DEFAULT NULL
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  product_id uuid,
  product_title text,
  readiness_score numeric,
  risk_level text,
  mastery_pct numeric,
  progress_pct numeric,
  last_exam_score numeric,
  last_activity_at timestamptz,
  inactive_days integer,
  seat_status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH seated AS (
  SELECT
    ols.user_id,
    ol.product_id,
    ol.org_id
  FROM public.org_license_seats ols
  JOIN public.org_licenses ol ON ol.id = ols.license_id
  WHERE ol.org_id = p_org_id
    AND ols.released_at IS NULL
    AND ol.status = 'active'
    AND (ol.ends_at IS NULL OR ol.ends_at > now())
    AND (p_product_id IS NULL OR ol.product_id = p_product_id)
),
-- Get latest readiness snapshot per user (already computed by the readiness engine)
latest_readiness AS (
  SELECT DISTINCT ON (rs.user_id)
    rs.user_id,
    rs.readiness_score,
    rs.risk_level,
    rs.mastery_pct,
    rs.created_at AS snapshot_at
  FROM public.readiness_snapshots rs
  WHERE rs.user_id IN (SELECT user_id FROM seated)
  ORDER BY rs.user_id, rs.created_at DESC
),
-- Progress: fraction of completed lessons per user
user_progress AS (
  SELECT
    lp.user_id,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE lp.completed = true) / NULLIF(COUNT(*), 0),
      1
    ) AS progress_pct,
    MAX(lp.updated_at) AS progress_last_at
  FROM public.learning_progress lp
  WHERE lp.user_id IN (SELECT user_id FROM seated)
  GROUP BY lp.user_id
),
-- Latest exam score per user
latest_exam AS (
  SELECT DISTINCT ON (ea.user_id)
    ea.user_id,
    ea.score AS last_exam_score,
    ea.started_at AS exam_at
  FROM public.exam_attempts ea
  WHERE ea.user_id IN (SELECT user_id FROM seated)
    AND ea.score IS NOT NULL
  ORDER BY ea.user_id, ea.started_at DESC
),
-- Activity: most recent timestamp across sources
activity AS (
  SELECT
    s.user_id,
    GREATEST(
      COALESCE(lr.snapshot_at, '2000-01-01'::timestamptz),
      COALESCE(up.progress_last_at, '2000-01-01'::timestamptz),
      COALESCE(le.exam_at, '2000-01-01'::timestamptz)
    ) AS last_activity_at
  FROM seated s
  LEFT JOIN latest_readiness lr ON lr.user_id = s.user_id
  LEFT JOIN user_progress up ON up.user_id = s.user_id
  LEFT JOIN latest_exam le ON le.user_id = s.user_id
)
SELECT
  s.user_id,
  COALESCE(li.display_name, 'Lernender') AS display_name,
  s.product_id,
  pr.title AS product_title,
  COALESCE(lr.readiness_score, 0)::numeric AS readiness_score,
  COALESCE(lr.risk_level, 'not_started') AS risk_level,
  COALESCE(lr.mastery_pct, 0)::numeric AS mastery_pct,
  COALESCE(up.progress_pct, 0)::numeric AS progress_pct,
  COALESCE(le.last_exam_score, 0)::numeric AS last_exam_score,
  a.last_activity_at,
  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - a.last_activity_at)) / 86400))::integer AS inactive_days,
  'active'::text AS seat_status
FROM seated s
LEFT JOIN public.learner_identities li ON li.user_id = s.user_id
LEFT JOIN public.products pr ON pr.id = s.product_id
LEFT JOIN latest_readiness lr ON lr.user_id = s.user_id
LEFT JOIN user_progress up ON up.user_id = s.user_id
LEFT JOIN latest_exam le ON le.user_id = s.user_id
LEFT JOIN activity a ON a.user_id = s.user_id
ORDER BY
  COALESCE(lr.readiness_score, 0) ASC,
  display_name ASC;
$$;

REVOKE ALL ON FUNCTION public.get_org_performance_dashboard(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_performance_dashboard(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_performance_dashboard(uuid, uuid) TO service_role;

-- RPC: get_org_performance_summary
-- Returns aggregated KPIs for the org performance dashboard
CREATE OR REPLACE FUNCTION public.get_org_performance_summary(
  p_org_id uuid,
  p_product_id uuid DEFAULT NULL
)
RETURNS TABLE (
  total_learners integer,
  avg_readiness numeric,
  high_risk_count integer,
  medium_risk_count integer,
  low_risk_count integer,
  inactive_count integer,
  not_started_count integer,
  avg_progress numeric,
  avg_exam_score numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH perf AS (
  SELECT * FROM public.get_org_performance_dashboard(p_org_id, p_product_id)
)
SELECT
  COUNT(*)::integer AS total_learners,
  ROUND(AVG(readiness_score), 1) AS avg_readiness,
  COUNT(*) FILTER (WHERE risk_level = 'high')::integer AS high_risk_count,
  COUNT(*) FILTER (WHERE risk_level = 'medium')::integer AS medium_risk_count,
  COUNT(*) FILTER (WHERE risk_level = 'low')::integer AS low_risk_count,
  COUNT(*) FILTER (WHERE inactive_days > 14)::integer AS inactive_count,
  COUNT(*) FILTER (WHERE risk_level = 'not_started')::integer AS not_started_count,
  ROUND(AVG(progress_pct), 1) AS avg_progress,
  ROUND(AVG(NULLIF(last_exam_score, 0)), 1) AS avg_exam_score
FROM perf;
$$;

REVOKE ALL ON FUNCTION public.get_org_performance_summary(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_performance_summary(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_performance_summary(uuid, uuid) TO service_role;
