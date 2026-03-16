
-- Must drop and recreate to change columns
DROP VIEW IF EXISTS public.v_admin_packages_ssot;
DROP VIEW IF EXISTS public.v_admin_queue_ssot;

-- Hardened v_admin_packages_ssot
CREATE VIEW public.v_admin_packages_ssot AS
WITH council_agg AS (
  SELECT
    cs.package_id,
    count(*) AS sessions_total,
    count(*) FILTER (WHERE cs.status = 'pending') AS sessions_pending,
    count(*) FILTER (WHERE cs.status = 'processing') AS sessions_processing,
    count(*) FILTER (WHERE cs.status = 'completed') AS sessions_completed,
    count(*) FILTER (WHERE cs.decision = 'approved') AS sessions_approved,
    max(greatest(cs.decided_at, cs.created_at)) AS last_council_activity_at
  FROM council_sessions cs
  GROUP BY cs.package_id
), content_agg AS (
  SELECT
    eq.curriculum_id,
    count(*) FILTER (WHERE eq.status = 'approved') AS approved_questions,
    count(*) AS total_questions
  FROM exam_questions eq
  GROUP BY eq.curriculum_id
), job_agg AS (
  SELECT
    jq.package_id,
    count(*) FILTER (WHERE jq.status IN ('pending','queued')) AS jobs_pending,
    count(*) FILTER (WHERE jq.status IN ('processing','running','batch_pending')) AS jobs_processing,
    count(*) FILTER (WHERE jq.status = 'failed') AS jobs_failed,
    max(jq.completed_at) AS last_job_completed_at,
    max(jq.last_error) FILTER (WHERE jq.status = 'failed') AS last_job_error,
    max(greatest(jq.started_at, jq.completed_at, jq.updated_at)) AS last_job_activity_at
  FROM job_queue jq
  GROUP BY jq.package_id
), ranked AS (
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
    cp.created_at,
    cp.updated_at,
    cp.last_error,
    cp.queue_position,
    cp.locked_at,
    vd.canonical_title,
    vd.beruf_id,
    vd.beruf_display_name,
    COALESCE(ca.sessions_total, 0) AS council_sessions_total,
    COALESCE(ca.sessions_pending, 0) AS council_sessions_pending,
    COALESCE(ca.sessions_processing, 0) AS council_sessions_processing,
    COALESCE(ca.sessions_completed, 0) AS council_sessions_completed,
    COALESCE(ca.sessions_approved, 0) AS council_sessions_approved,
    COALESCE(cta.approved_questions, 0) AS approved_questions,
    COALESCE(cta.total_questions, 0) AS total_questions,
    COALESCE(ja.jobs_pending, 0) AS jobs_pending,
    COALESCE(ja.jobs_processing, 0) AS jobs_processing,
    COALESCE(ja.jobs_failed, 0) AS jobs_failed,
    ja.last_job_completed_at,
    ja.last_job_error,
    CASE WHEN cp.status <> 'published' AND cp.published_at IS NOT NULL THEN true ELSE false END AS has_stale_publish,
    CASE
      WHEN cp.status IN ('building','council_review')
       AND greatest(
         coalesce(cp.last_progress_at, 'epoch'::timestamptz),
         coalesce(ja.last_job_activity_at, 'epoch'::timestamptz),
         coalesce(ca.last_council_activity_at, 'epoch'::timestamptz),
         cp.updated_at
       ) < now() - interval '30 minutes'
      THEN true ELSE false
    END AS is_stuck,
    CASE
      WHEN COALESCE(ca.sessions_pending, 0) = 0
       AND COALESCE(ca.sessions_processing, 0) = 0
       AND COALESCE(ca.sessions_completed, 0) > 0
      THEN true ELSE false
    END AS council_complete,
    CASE
      WHEN cp.status = 'published' AND COALESCE(cta.approved_questions, 0) < 100 THEN true
      WHEN cp.status = 'published' AND cp.council_approved IS NOT TRUE THEN true
      WHEN cp.status = 'published' AND cp.integrity_passed IS NOT TRUE THEN true
      ELSE false
    END AS has_publish_drift,
    row_number() OVER (
      PARTITION BY COALESCE(vd.beruf_id::text, cp.curriculum_id::text, cp.title)
      ORDER BY
        CASE cp.status
          WHEN 'building' THEN 1
          WHEN 'council_review' THEN 2
          WHEN 'queued' THEN 3
          WHEN 'blocked' THEN 4
          WHEN 'published' THEN 5
          WHEN 'failed' THEN 6
          ELSE 50
        END,
        cp.updated_at DESC NULLS LAST
    ) AS dedup_rank
  FROM course_packages cp
  LEFT JOIN v_course_display_ssot vd ON vd.package_id = cp.id
  LEFT JOIN council_agg ca ON ca.package_id = cp.id
  LEFT JOIN content_agg cta ON cta.curriculum_id = cp.curriculum_id
  LEFT JOIN job_agg ja ON ja.package_id = cp.id
  WHERE cp.archived IS NOT TRUE
)
SELECT
  package_id, raw_title, curriculum_id, status, track, priority,
  build_progress, current_step, blocked_reason, stuck_reason,
  last_progress_at, council_approved, council_approved_at,
  integrity_passed, published_at, is_published, created_at, updated_at,
  last_error, queue_position, locked_at, canonical_title,
  beruf_id, beruf_display_name,
  council_sessions_total, council_sessions_pending, council_sessions_processing,
  council_sessions_completed, council_sessions_approved,
  approved_questions, total_questions,
  jobs_pending, jobs_processing, jobs_failed,
  last_job_completed_at, last_job_error,
  has_stale_publish, is_stuck, council_complete, has_publish_drift
FROM ranked
WHERE dedup_rank = 1;

-- Hardened v_admin_queue_ssot with running/batch_pending support
CREATE VIEW public.v_admin_queue_ssot AS
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
  cp.title AS package_raw_title,
  cp.status AS package_status,
  cp.current_step AS package_current_step,
  cp.blocked_reason AS package_blocked_reason,
  EXTRACT(epoch FROM (now() - jq.created_at)) AS age_seconds,
  CASE
    WHEN jq.status IN ('processing','running','batch_pending') AND jq.last_heartbeat_at < (now() - interval '2 minutes') THEN 'zombie'
    WHEN jq.status IN ('processing','running') AND jq.locked_at < (now() - interval '10 minutes') THEN 'stale_lock'
    WHEN jq.status = 'failed' AND jq.attempts >= jq.max_attempts THEN 'exhausted'
    WHEN jq.status = 'failed' THEN 'retriable'
    WHEN jq.status IN ('pending','queued') AND jq.created_at < (now() - interval '1 hour') THEN 'aging'
    ELSE 'normal'
  END AS health_signal
FROM job_queue jq
LEFT JOIN course_packages cp ON cp.id = jq.package_id
WHERE jq.status IN ('pending','queued','processing','failed','batch_pending','running')
   OR (jq.status = 'completed' AND jq.completed_at > (now() - interval '1 hour'));
