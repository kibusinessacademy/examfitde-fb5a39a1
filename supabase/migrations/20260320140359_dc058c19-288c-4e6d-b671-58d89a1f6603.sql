-- Harden stale/stuck classification: do not mark packages as stuck while there is still active queue work.
-- Forensic evidence showed packages flagged as is_stuck despite pending core jobs and repair_class = A_HEALTHY.

CREATE OR REPLACE VIEW public.v_admin_packages_ssot AS
WITH council_agg AS (
  SELECT
    cs.package_id,
    count(*) AS sessions_total,
    count(*) FILTER (WHERE cs.status = 'pending') AS sessions_pending,
    count(*) FILTER (WHERE cs.status = 'processing') AS sessions_processing,
    count(*) FILTER (WHERE cs.status = 'completed') AS sessions_completed,
    count(*) FILTER (WHERE cs.decision = 'approved') AS sessions_approved,
    max(COALESCE(cs.decided_at, cs.created_at)) AS last_council_activity_at
  FROM public.council_sessions cs
  GROUP BY cs.package_id
),
job_agg AS (
  SELECT
    jq.package_id,
    count(*) FILTER (WHERE jq.status = ANY (ARRAY['pending','queued'])) AS jobs_pending,
    count(*) FILTER (WHERE jq.status = ANY (ARRAY['processing','running','batch_pending'])) AS jobs_processing,
    count(*) FILTER (WHERE jq.status = 'failed') AS jobs_failed,
    max(GREATEST(jq.started_at, jq.completed_at, jq.updated_at)) AS last_job_activity_at,
    max(jq.completed_at) AS last_job_completed_at,
    (array_agg(jq.last_error ORDER BY jq.updated_at DESC) FILTER (WHERE jq.last_error IS NOT NULL))[1] AS last_job_error
  FROM public.job_queue jq
  WHERE jq.package_id IS NOT NULL
  GROUP BY jq.package_id
),
question_agg AS (
  SELECT
    cp2.id AS package_id,
    count(*) AS total_questions,
    count(*) FILTER (WHERE eq.status = 'approved'::public.question_status) AS approved_questions
  FROM public.course_packages cp2
  JOIN public.exam_questions eq ON eq.curriculum_id = cp2.curriculum_id
  GROUP BY cp2.id
)
SELECT
  cp.id AS package_id,
  cp.title AS raw_title,
  cp.curriculum_id,
  cp.status,
  vd.canonical_title,
  vd.beruf_id,
  vd.beruf_display_name,
  cp.priority,
  cp.build_progress,
  (
    SELECT ps.step_key
    FROM public.package_steps ps
    WHERE ps.package_id = cp.id
      AND ps.status = 'running'::public.step_status
    LIMIT 1
  ) AS current_step,
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
  COALESCE(vd.canonical_title, cp.title) AS track,
  COALESCE(ca.sessions_total, 0::bigint) AS council_sessions_total,
  COALESCE(ca.sessions_pending, 0::bigint) AS council_sessions_pending,
  COALESCE(ca.sessions_processing, 0::bigint) AS council_sessions_processing,
  COALESCE(ca.sessions_completed, 0::bigint) AS council_sessions_completed,
  COALESCE(ca.sessions_approved, 0::bigint) AS council_sessions_approved,
  CASE
    WHEN COALESCE(ca.sessions_total, 0::bigint) = 0 THEN false
    WHEN COALESCE(ca.sessions_pending, 0::bigint) = 0
      AND COALESCE(ca.sessions_processing, 0::bigint) = 0
      AND COALESCE(ca.sessions_completed, 0::bigint) > 0 THEN true
    ELSE false
  END AS council_complete,
  COALESCE(qa.approved_questions, 0::bigint) AS approved_questions,
  COALESCE(qa.total_questions, 0::bigint) AS total_questions,
  COALESCE(ja.jobs_pending, 0::bigint) AS jobs_pending,
  COALESCE(ja.jobs_processing, 0::bigint) AS jobs_processing,
  COALESCE(ja.jobs_failed, 0::bigint) AS jobs_failed,
  ja.last_job_completed_at,
  ja.last_job_error,
  CASE
    WHEN cp.status <> 'published' AND cp.published_at IS NOT NULL THEN true
    ELSE false
  END AS has_stale_publish,
  CASE
    WHEN cp.status = ANY (ARRAY['building','council_review'])
      AND COALESCE(ja.jobs_pending, 0::bigint) = 0
      AND COALESCE(ja.jobs_processing, 0::bigint) = 0
      AND GREATEST(
        COALESCE(cp.last_progress_at, '1970-01-01 00:00:00+00'::timestamptz),
        COALESCE(ja.last_job_activity_at, '1970-01-01 00:00:00+00'::timestamptz),
        COALESCE(ca.last_council_activity_at, '1970-01-01 00:00:00+00'::timestamptz),
        cp.updated_at
      ) < (now() - interval '30 minutes') THEN true
    ELSE false
  END AS is_stuck,
  CASE
    WHEN cp.status = 'published' AND COALESCE(qa.approved_questions, 0::bigint) < 100 THEN true
    WHEN cp.status = 'published' AND cp.integrity_passed IS NOT TRUE THEN true
    ELSE false
  END AS has_publish_drift
FROM public.course_packages cp
LEFT JOIN public.v_course_display_ssot vd ON vd.package_id = cp.id
LEFT JOIN council_agg ca ON ca.package_id = cp.id
LEFT JOIN job_agg ja ON ja.package_id = cp.id
LEFT JOIN question_agg qa ON qa.package_id = cp.id
WHERE cp.status <> 'archived';