
-- =============================================
-- ADMIN V2 SSOT VIEWS
-- =============================================

-- 1. v_admin_packages_ssot: Canonical package list with all SSOT signals
CREATE OR REPLACE VIEW public.v_admin_packages_ssot AS
WITH council_agg AS (
  SELECT
    cs.package_id,
    count(*) AS sessions_total,
    count(*) FILTER (WHERE cs.status = 'pending') AS sessions_pending,
    count(*) FILTER (WHERE cs.status = 'processing') AS sessions_processing,
    count(*) FILTER (WHERE cs.status = 'completed') AS sessions_completed,
    count(*) FILTER (WHERE cs.decision = 'approved') AS sessions_approved
  FROM public.council_sessions cs
  GROUP BY cs.package_id
),
content_agg AS (
  SELECT
    eq.curriculum_id,
    count(*) FILTER (WHERE eq.status = 'approved') AS approved_questions,
    count(*) AS total_questions
  FROM public.exam_questions eq
  GROUP BY eq.curriculum_id
),
job_agg AS (
  SELECT
    jq.package_id,
    count(*) FILTER (WHERE jq.status IN ('pending','queued')) AS jobs_pending,
    count(*) FILTER (WHERE jq.status = 'processing') AS jobs_processing,
    count(*) FILTER (WHERE jq.status = 'failed') AS jobs_failed,
    max(jq.completed_at) AS last_job_completed_at,
    max(jq.last_error) FILTER (WHERE jq.status = 'failed') AS last_job_error
  FROM public.job_queue jq
  GROUP BY jq.package_id
),
ranked AS (
  SELECT
    cp.id AS package_id,
    cp.title AS raw_title,
    cp.curriculum_id,
    cp.status,
    cp.track,
    cp.priority,
    cp.build_progress,
    cp.current_step,
    cp.blocked_reason,
    cp.stuck_reason,
    cp.last_progress_at,
    cp.council_approved,
    cp.council_approved_at,
    cp.integrity_passed,
    cp.published_at,
    cp.is_published,
    cp.archived,
    cp.created_at,
    cp.updated_at,
    cp.last_error,
    cp.queue_position,
    cp.locked_at,
    -- SSOT title from display view
    vd.canonical_title,
    vd.beruf_id,
    vd.beruf_display_name,
    -- Council
    COALESCE(ca.sessions_total, 0) AS council_sessions_total,
    COALESCE(ca.sessions_pending, 0) AS council_sessions_pending,
    COALESCE(ca.sessions_processing, 0) AS council_sessions_processing,
    COALESCE(ca.sessions_completed, 0) AS council_sessions_completed,
    COALESCE(ca.sessions_approved, 0) AS council_sessions_approved,
    -- Content (via curriculum_id)
    COALESCE(cta.approved_questions, 0) AS approved_questions,
    COALESCE(cta.total_questions, 0) AS total_questions,
    -- Jobs
    COALESCE(ja.jobs_pending, 0) AS jobs_pending,
    COALESCE(ja.jobs_processing, 0) AS jobs_processing,
    COALESCE(ja.jobs_failed, 0) AS jobs_failed,
    ja.last_job_completed_at,
    ja.last_job_error,
    -- Derived SSOT signals
    CASE WHEN cp.status <> 'published' AND cp.published_at IS NOT NULL THEN true ELSE false END AS has_stale_publish,
    CASE
      WHEN cp.status IN ('building','council_review') 
        AND cp.last_progress_at < now() - interval '30 minutes' THEN true
      ELSE false
    END AS is_stuck,
    CASE
      WHEN COALESCE(ca.sessions_pending, 0) = 0 
        AND COALESCE(ca.sessions_processing, 0) = 0
        AND COALESCE(ca.sessions_completed, 0) > 0
        AND cp.council_approved = true THEN true
      ELSE false
    END AS council_complete,
    -- Deduplication rank
    row_number() OVER (
      PARTITION BY COALESCE(vd.beruf_id::text, cp.curriculum_id::text, cp.title)
      ORDER BY
        CASE cp.status
          WHEN 'published' THEN 1
          WHEN 'building' THEN 2
          WHEN 'council_review' THEN 3
          WHEN 'queued' THEN 4
          WHEN 'blocked' THEN 5
          WHEN 'failed' THEN 6
          ELSE 50
        END,
        cp.updated_at DESC NULLS LAST
    ) AS dedup_rank
  FROM public.course_packages cp
  LEFT JOIN public.v_course_display_ssot vd ON vd.package_id = cp.id
  LEFT JOIN council_agg ca ON ca.package_id = cp.id
  LEFT JOIN content_agg cta ON cta.curriculum_id = cp.curriculum_id
  LEFT JOIN job_agg ja ON ja.package_id = cp.id
  WHERE cp.archived IS NOT TRUE
)
SELECT * FROM ranked WHERE dedup_rank = 1;

-- 2. v_admin_queue_ssot: Operations queue with full context
CREATE OR REPLACE VIEW public.v_admin_queue_ssot AS
SELECT
  jq.id AS job_id,
  jq.job_type,
  jq.status AS job_status,
  jq.priority AS job_priority,
  jq.attempts,
  jq.max_attempts,
  jq.created_at AS job_created_at,
  jq.started_at AS job_started_at,
  jq.completed_at AS job_completed_at,
  jq.locked_at,
  jq.locked_by,
  jq.last_error,
  jq.last_error_code,
  jq.last_error_severity,
  jq.last_heartbeat_at,
  jq.liveness_status,
  jq.run_after,
  jq.rate_limited_until,
  jq.package_id,
  jq.worker_pool,
  jq.fallback_count,
  jq.parent_job_id,
  -- Package context
  cp.title AS package_raw_title,
  cp.status AS package_status,
  cp.current_step AS package_current_step,
  cp.blocked_reason AS package_blocked_reason,
  -- Age
  EXTRACT(EPOCH FROM (now() - jq.created_at)) AS age_seconds,
  CASE
    WHEN jq.status = 'processing' AND jq.last_heartbeat_at < now() - interval '2 minutes' THEN 'zombie'
    WHEN jq.status = 'processing' AND jq.locked_at < now() - interval '10 minutes' THEN 'stale_lock'
    WHEN jq.status = 'failed' AND jq.attempts >= jq.max_attempts THEN 'exhausted'
    WHEN jq.status = 'failed' THEN 'retriable'
    WHEN jq.status IN ('pending','queued') AND jq.created_at < now() - interval '1 hour' THEN 'aging'
    ELSE 'normal'
  END AS health_signal
FROM public.job_queue jq
LEFT JOIN public.course_packages cp ON cp.id = jq.package_id
WHERE jq.status IN ('pending','queued','processing','failed','batch_pending')
  OR (jq.status = 'completed' AND jq.completed_at > now() - interval '1 hour');
