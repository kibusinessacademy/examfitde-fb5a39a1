
CREATE OR REPLACE VIEW public.ops_orphan_step_audit AS
WITH building_packages AS (
  SELECT cp.id AS package_id, cp.track, cp.curriculum_id, cp.course_id
  FROM course_packages cp
  WHERE cp.status = 'building'
),
open_steps AS (
  SELECT
    ps.package_id,
    ps.step_key,
    ps.status AS step_status,
    ps.created_at AS step_created_at,
    ps.updated_at AS step_updated_at,
    EXTRACT(EPOCH FROM (now() - ps.updated_at)) / 60 AS step_age_minutes
  FROM package_steps ps
  JOIN building_packages bp ON bp.package_id = ps.package_id
  WHERE ps.status IN ('queued', 'enqueued')
),
active_jobs AS (
  SELECT DISTINCT jq.package_id, sjm.step_key
  FROM job_queue jq
  JOIN step_job_mapping sjm ON jq.job_type = ANY(sjm.job_types)
  WHERE jq.status IN ('pending', 'processing', 'queued')
    AND jq.package_id IS NOT NULL
),
recent_completed AS (
  SELECT DISTINCT jq.package_id, sjm.step_key
  FROM job_queue jq
  JOIN step_job_mapping sjm ON jq.job_type = ANY(sjm.job_types)
  WHERE jq.status = 'completed'
    AND jq.completed_at > now() - interval '15 minutes'
    AND jq.package_id IS NOT NULL
),
dag_readiness AS (
  SELECT
    os.package_id,
    os.step_key,
    bool_and(COALESCE(dep_ps.status, 'done') IN ('done', 'skipped')) AS dag_ready
  FROM open_steps os
  LEFT JOIN step_dag_edges sde ON sde.step_key = os.step_key
  LEFT JOIN package_steps dep_ps
    ON dep_ps.package_id = os.package_id
    AND dep_ps.step_key = sde.depends_on
  GROUP BY os.package_id, os.step_key
),
track_applicability AS (
  SELECT bp.package_id, tsa.step_key, tsa.should_run
  FROM building_packages bp
  JOIN track_step_applicability tsa ON tsa.track = bp.track
),
guard_evidence AS (
  SELECT DISTINCT ON ((ge.details->>'package_id')::uuid, COALESCE(ge.details->>'step_key', ge.details->>'step_auto_completed', substring(ge.details->>'job_type' FROM 9)))
    (ge.details->>'package_id')::uuid AS package_id,
    COALESCE(ge.details->>'step_key', ge.details->>'step_auto_completed', substring(ge.details->>'job_type' FROM 9)) AS step_key,
    ge.guard_key,
    ge.created_at AS guard_event_at
  FROM ops_guardrail_events ge
  WHERE ge.created_at > now() - interval '24 hours'
    AND ge.details->>'package_id' IS NOT NULL
  ORDER BY (ge.details->>'package_id')::uuid, COALESCE(ge.details->>'step_key', ge.details->>'step_auto_completed', substring(ge.details->>'job_type' FROM 9)), ge.created_at DESC
)
SELECT
  os.package_id,
  os.step_key,
  os.step_status::text,
  round(os.step_age_minutes::numeric, 1) AS step_age_minutes,
  CASE
    WHEN ge.guard_key IS NOT NULL THEN 'guard_swallowed'
    WHEN COALESCE(dr.dag_ready, true) AND os.step_age_minutes > 15 THEN 'materializer_gap'
    ELSE 'orphan_queued'
  END AS orphan_class,
  ge.guard_key AS guard_evidence,
  COALESCE(dr.dag_ready, true) AS dag_ready,
  os.step_created_at,
  os.step_updated_at,
  bp.track,
  c.title AS course_title
FROM open_steps os
JOIN building_packages bp ON bp.package_id = os.package_id
LEFT JOIN courses c ON c.id = bp.course_id
LEFT JOIN active_jobs aj ON aj.package_id = os.package_id AND aj.step_key = os.step_key
LEFT JOIN recent_completed rc ON rc.package_id = os.package_id AND rc.step_key = os.step_key
LEFT JOIN dag_readiness dr ON dr.package_id = os.package_id AND dr.step_key = os.step_key
LEFT JOIN track_applicability ta ON ta.package_id = os.package_id AND ta.step_key = os.step_key
LEFT JOIN guard_evidence ge ON ge.package_id = os.package_id AND ge.step_key = os.step_key
WHERE
  aj.step_key IS NULL
  AND rc.step_key IS NULL
  AND COALESCE(ta.should_run, true) = true
  AND os.step_age_minutes > 15
ORDER BY
  CASE
    WHEN ge.guard_key IS NOT NULL THEN 1
    WHEN COALESCE(dr.dag_ready, true) THEN 2
    ELSE 3
  END,
  os.step_age_minutes DESC;
