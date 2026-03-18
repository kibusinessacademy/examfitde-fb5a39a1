
CREATE OR REPLACE VIEW public.ops_telemetry_lineage AS
WITH building_pkgs AS (
  SELECT cp.id AS package_id, cp.title, cp.course_id
  FROM course_packages cp
  WHERE cp.status IN ('building', 'published')
),
content_by_source AS (
  SELECT
    bp.package_id,
    bp.title,
    COALESCE(cv.created_by_agent, 'unknown') AS content_source,
    cv.lesson_id,
    count(*) AS version_count,
    count(*) FILTER (WHERE cv.created_at >= now() - interval '24 hours') AS versions_24h,
    max(cv.created_at) AS last_version_at
  FROM content_versions cv
  JOIN building_pkgs bp ON bp.course_id = cv.course_id
  GROUP BY bp.package_id, bp.title, 
           COALESCE(cv.created_by_agent, 'unknown'),
           cv.lesson_id
),
llm_by_package AS (
  SELECT
    lce.package_id,
    lce.provider,
    lce.model,
    lce.job_type,
    count(*) AS event_count,
    count(*) FILTER (WHERE lce.ts >= now() - interval '24 hours') AS events_24h,
    max(lce.ts) AS last_event_at
  FROM llm_cost_events lce
  WHERE lce.package_id IN (SELECT package_id FROM building_pkgs)
  GROUP BY lce.package_id, lce.provider, lce.model, lce.job_type
),
pkg_summary AS (
  SELECT
    cs.package_id,
    cs.title,
    sum(cs.versions_24h)::int AS content_24h,
    count(DISTINCT cs.lesson_id) AS lessons_with_content,
    array_agg(DISTINCT cs.content_source) AS content_sources
  FROM content_by_source cs
  GROUP BY cs.package_id, cs.title
),
llm_summary AS (
  SELECT
    lp.package_id,
    sum(lp.events_24h)::int AS llm_24h,
    array_agg(DISTINCT lp.provider) AS llm_providers,
    array_agg(DISTINCT lp.model) AS llm_models,
    array_agg(DISTINCT lp.job_type) AS llm_job_types
  FROM llm_by_package lp
  GROUP BY lp.package_id
)
SELECT
  ps.package_id,
  ps.title,
  ps.content_24h,
  COALESCE(ls.llm_24h, 0) AS llm_24h,
  ps.lessons_with_content,
  ps.content_sources,
  COALESCE(ls.llm_providers, ARRAY[]::text[]) AS llm_providers,
  COALESCE(ls.llm_models, ARRAY[]::text[]) AS llm_models,
  COALESCE(ls.llm_job_types, ARRAY[]::text[]) AS llm_job_types,
  CASE
    WHEN ps.content_24h > 10 AND COALESCE(ls.llm_24h, 0) = 0 THEN 'BLIND'
    WHEN ps.content_24h > 10 AND COALESCE(ls.llm_24h, 0) < ps.content_24h * 0.3 THEN 'PARTIAL'
    WHEN ps.content_24h > 0 AND COALESCE(ls.llm_24h, 0) >= ps.content_24h * 0.3 THEN 'COVERED'
    ELSE 'INACTIVE'
  END AS coverage_status,
  CASE
    WHEN COALESCE(ls.llm_24h, 0) = 0 THEN -1
    ELSE round(ls.llm_24h::numeric / NULLIF(ps.content_24h, 0), 2)
  END AS coverage_ratio,
  now() AS computed_at
FROM pkg_summary ps
LEFT JOIN llm_summary ls ON ls.package_id = ps.package_id
ORDER BY 
  CASE 
    WHEN ps.content_24h > 10 AND COALESCE(ls.llm_24h, 0) = 0 THEN 0
    WHEN ps.content_24h > 10 AND COALESCE(ls.llm_24h, 0) < ps.content_24h * 0.3 THEN 1
    ELSE 2
  END,
  ps.content_24h DESC;
