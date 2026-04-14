
DROP VIEW IF EXISTS public.v_admin_packages_ssot;

CREATE VIEW public.v_admin_packages_ssot AS
WITH council_agg AS (
  SELECT cs.package_id,
    count(*) AS sessions_total,
    count(*) FILTER (WHERE cs.status = 'pending') AS sessions_pending,
    count(*) FILTER (WHERE cs.status = 'processing') AS sessions_processing,
    count(*) FILTER (WHERE cs.status = 'completed') AS sessions_completed,
    count(*) FILTER (WHERE cs.decision = 'approved') AS sessions_approved,
    max(COALESCE(cs.decided_at, cs.created_at)) AS last_council_activity_at
  FROM council_sessions cs
  GROUP BY cs.package_id
), job_agg AS (
  SELECT jq.package_id,
    count(*) FILTER (WHERE jq.status = ANY (ARRAY['pending','queued'])) AS jobs_pending,
    count(*) FILTER (WHERE jq.status = ANY (ARRAY['processing','running','batch_pending'])) AS jobs_processing,
    count(*) FILTER (WHERE jq.status = 'failed') AS jobs_failed,
    max(GREATEST(jq.started_at, jq.completed_at, jq.updated_at)) AS last_job_activity_at,
    max(jq.completed_at) AS last_job_completed_at,
    (array_agg(jq.last_error ORDER BY jq.updated_at DESC) FILTER (WHERE jq.last_error IS NOT NULL))[1] AS last_job_error,
    count(*) FILTER (WHERE jq.status IN ('processing','running') AND jq.updated_at > now() - interval '5 minutes') AS fresh_processing_jobs,
    max(jq.updated_at) FILTER (WHERE jq.status IN ('processing','running')) AS latest_processing_at
  FROM job_queue jq
  WHERE jq.package_id IS NOT NULL
  GROUP BY jq.package_id
), question_agg AS (
  SELECT cp2.id AS package_id,
    count(*) AS total_questions,
    count(*) FILTER (WHERE eq.status = 'approved'::question_status) AS approved_questions
  FROM course_packages cp2
    JOIN exam_questions eq ON eq.curriculum_id = cp2.curriculum_id
  GROUP BY cp2.id
), step_agg AS (
  SELECT ps.package_id,
    count(*) FILTER (WHERE ps.status = 'done'::step_status) AS steps_done,
    count(*) FILTER (WHERE ps.status <> 'skipped'::step_status) AS steps_functional
  FROM package_steps ps
  GROUP BY ps.package_id
), active_step AS (
  SELECT DISTINCT ON (jq.package_id) jq.package_id,
    sjm.step_key
  FROM job_queue jq
    JOIN step_job_mapping sjm ON jq.job_type = ANY (sjm.job_types)
  WHERE (jq.status = ANY (ARRAY['processing','pending','queued'])) AND jq.package_id IS NOT NULL
  ORDER BY jq.package_id, (
    CASE jq.status
      WHEN 'processing' THEN 0
      WHEN 'pending' THEN 1
      WHEN 'queued' THEN 2
      ELSE 3
    END), jq.created_at
)
SELECT cp.id AS package_id,
  cp.title AS raw_title,
  cp.curriculum_id,
  cp.status,
  vd.canonical_title,
  vd.beruf_id,
  vd.beruf_display_name,
  cp.priority,
  cp.build_progress,
  COALESCE(ast.step_key, (
    SELECT ps2.step_key
    FROM package_steps ps2
    WHERE ps2.package_id = cp.id AND (ps2.status <> ALL (ARRAY['done'::step_status, 'skipped'::step_status]))
    ORDER BY ps2.step_key
    LIMIT 1
  )) AS current_step,
  cp.blocked_reason,
  cp.stuck_reason,
  cp.last_progress_at,
  cp.council_approved,
  cp.council_approved_at,
  cp.integrity_passed,
  cp.published_at,
  CASE WHEN cp.status = 'published' THEN true ELSE false END AS is_published,
  cp.created_at,
  cp.updated_at,
  cp.last_error,
  cp.queue_position,
  cp.locked_at,
  cp.track::text AS track,
  COALESCE(sa.steps_done, 0::bigint) AS steps_done,
  COALESCE(sa.steps_functional, 0::bigint) AS steps_functional,
  COALESCE(ca.sessions_total, 0::bigint) AS council_sessions_total,
  COALESCE(ca.sessions_pending, 0::bigint) AS council_sessions_pending,
  COALESCE(ca.sessions_processing, 0::bigint) AS council_sessions_processing,
  COALESCE(ca.sessions_completed, 0::bigint) AS council_sessions_completed,
  COALESCE(ca.sessions_approved, 0::bigint) AS council_sessions_approved,
  CASE
    WHEN COALESCE(ca.sessions_total, 0::bigint) = 0 THEN false
    WHEN COALESCE(ca.sessions_pending, 0::bigint) = 0 AND COALESCE(ca.sessions_processing, 0::bigint) = 0 AND COALESCE(ca.sessions_completed, 0::bigint) > 0 THEN true
    ELSE false
  END AS council_complete,
  COALESCE(qa.approved_questions, 0::bigint) AS approved_questions,
  COALESCE(qa.total_questions, 0::bigint) AS total_questions,
  COALESCE(ja.jobs_pending, 0::bigint) AS jobs_pending,
  COALESCE(ja.jobs_processing, 0::bigint) AS jobs_processing,
  COALESCE(ja.jobs_failed, 0::bigint) AS jobs_failed,
  ja.last_job_completed_at,
  ja.last_job_error,
  -- has_stale_publish
  CASE
    WHEN cp.status <> 'published' AND cp.published_at IS NOT NULL THEN true
    ELSE false
  END AS has_stale_publish,
  -- HARDENED is_stuck
  CASE
    WHEN cp.status <> 'building' THEN false
    WHEN COALESCE(ja.fresh_processing_jobs, 0) > 0 THEN false
    WHEN COALESCE(ja.jobs_processing, 0) > 0 
      AND ja.latest_processing_at > now() - interval '15 minutes' THEN false
    WHEN COALESCE(ja.jobs_pending, 0) = 0 
      AND COALESCE(ja.jobs_processing, 0) = 0 
      AND COALESCE(ja.jobs_failed, 0) = 0 THEN true
    WHEN cp.last_progress_at < (now() - interval '30 minutes')
      AND (ja.last_job_activity_at IS NULL OR ja.last_job_activity_at < now() - interval '30 minutes') THEN true
    ELSE false
  END AS is_stuck,
  -- stuck_class for context-sensitive UI
  CASE
    WHEN cp.status <> 'building' THEN NULL
    WHEN COALESCE(ja.fresh_processing_jobs, 0) > 0 THEN 'active_processing'
    WHEN COALESCE(ja.jobs_processing, 0) > 0 
      AND ja.latest_processing_at > now() - interval '15 minutes' THEN 'active_processing'
    WHEN COALESCE(ja.jobs_pending, 0) = 0 
      AND COALESCE(ja.jobs_processing, 0) = 0 
      AND COALESCE(ja.jobs_failed, 0) = 0 THEN 'no_jobs'
    WHEN COALESCE(ja.jobs_failed, 0) > 0 
      AND COALESCE(ja.jobs_pending, 0) = 0 
      AND COALESCE(ja.jobs_processing, 0) = 0 THEN 'failed_jobs'
    WHEN COALESCE(ja.jobs_pending, 0) > 0 
      AND COALESCE(ja.jobs_processing, 0) = 0
      AND (ja.last_job_activity_at IS NULL OR ja.last_job_activity_at < now() - interval '30 minutes') THEN 'claim_starvation'
    ELSE NULL
  END::text AS stuck_class,
  -- has_publish_drift
  CASE
    WHEN cp.status <> 'published' AND cp.published_at IS NOT NULL AND cp.build_progress < 100 THEN true
    ELSE false
  END AS has_publish_drift
FROM course_packages cp
  LEFT JOIN v_course_display_ssot vd ON vd.package_id = cp.id
  LEFT JOIN step_agg sa ON sa.package_id = cp.id
  LEFT JOIN council_agg ca ON ca.package_id = cp.id
  LEFT JOIN job_agg ja ON ja.package_id = cp.id
  LEFT JOIN question_agg qa ON qa.package_id = cp.id
  LEFT JOIN active_step ast ON ast.package_id = cp.id;
