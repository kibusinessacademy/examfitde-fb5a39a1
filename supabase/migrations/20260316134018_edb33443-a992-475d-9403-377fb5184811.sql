
-- ============================================================
-- HARDENING PATCH v2: Fix council_sessions column reference
-- ============================================================

-- 1. Fix v_admin_visible_course_packages: operative ranking
DROP VIEW IF EXISTS public.v_ops_course_name_collisions CASCADE;
DROP VIEW IF EXISTS public.v_ops_invalid_course_titles CASCADE;
DROP VIEW IF EXISTS public.v_admin_visible_course_packages CASCADE;

CREATE VIEW public.v_admin_visible_course_packages AS
WITH ranked AS (
  SELECT s.*,
    row_number() OVER (
      PARTITION BY coalesce(s.beruf_id::text, s.curriculum_id::text, s.canonical_title_norm)
      ORDER BY
        CASE s.status
          WHEN 'building' THEN 1
          WHEN 'council_review' THEN 2
          WHEN 'queued' THEN 3
          WHEN 'blocked' THEN 4
          WHEN 'quality_gate_failed' THEN 5
          WHEN 'published' THEN 6
          WHEN 'qa' THEN 7
          WHEN 'planning' THEN 8
          WHEN 'failed' THEN 9
          ELSE 99
        END,
        s.updated_at DESC NULLS LAST,
        s.created_at DESC
    ) AS rn
  FROM public.v_course_display_ssot s
)
SELECT package_id, id, course_id, curriculum_id, status, build_progress,
  integrity_passed, council_approved, council_approved_at, published_at,
  created_at, updated_at, components, created_by, priority,
  beruf_id, canonical_title, canonical_title AS title, canonical_title_norm,
  raw_course_title, raw_curriculum_title, beruf_display_name
FROM ranked WHERE rn = 1;

CREATE VIEW public.v_ops_course_name_collisions AS
SELECT canonical_title_norm, count(*) AS cnt,
  array_agg(package_id ORDER BY created_at DESC) AS package_ids,
  array_agg(canonical_title ORDER BY created_at DESC) AS canonical_titles
FROM public.v_course_display_ssot
GROUP BY canonical_title_norm HAVING count(*) > 1;

CREATE VIEW public.v_ops_invalid_course_titles AS
SELECT package_id, status, raw_course_title, raw_curriculum_title,
  canonical_title, canonical_title_norm, created_at
FROM public.v_course_display_ssot
WHERE public.normalize_course_title(coalesce(raw_course_title, raw_curriculum_title, ''))
      <> canonical_title_norm;

-- 2. Recreate v_admin_packages_ssot with full hardening
DROP VIEW IF EXISTS public.v_admin_packages_ssot CASCADE;

CREATE VIEW public.v_admin_packages_ssot AS
WITH council_agg AS (
  SELECT
    cs.package_id,
    count(*) AS sessions_total,
    count(*) FILTER (WHERE cs.status = 'pending') AS sessions_pending,
    count(*) FILTER (WHERE cs.status = 'processing') AS sessions_processing,
    count(*) FILTER (WHERE cs.status = 'completed') AS sessions_completed,
    count(*) FILTER (WHERE cs.decision = 'approved') AS sessions_approved,
    max(coalesce(cs.decided_at, cs.created_at)) AS last_council_activity_at
  FROM public.council_sessions cs
  GROUP BY cs.package_id
),
job_agg AS (
  SELECT
    jq.package_id,
    count(*) FILTER (WHERE jq.status IN ('pending','queued')) AS jobs_pending,
    count(*) FILTER (WHERE jq.status IN ('processing','running','batch_pending')) AS jobs_processing,
    count(*) FILTER (WHERE jq.status = 'failed') AS jobs_failed,
    max(greatest(jq.started_at, jq.completed_at, jq.updated_at)) AS last_job_activity_at,
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
    count(*) FILTER (WHERE eq.status = 'approved') AS approved_questions
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
  (SELECT ps.step_key FROM public.package_steps ps WHERE ps.package_id = cp.id AND ps.status = 'running' LIMIT 1) AS current_step,
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
  COALESCE(ca.sessions_total, 0) AS council_sessions_total,
  COALESCE(ca.sessions_pending, 0) AS council_sessions_pending,
  COALESCE(ca.sessions_processing, 0) AS council_sessions_processing,
  COALESCE(ca.sessions_completed, 0) AS council_sessions_completed,
  COALESCE(ca.sessions_approved, 0) AS council_sessions_approved,
  -- council_complete: purely from sessions, WITHOUT council_approved flag
  CASE
    WHEN COALESCE(ca.sessions_total, 0) = 0 THEN false
    WHEN COALESCE(ca.sessions_pending, 0) = 0
     AND COALESCE(ca.sessions_processing, 0) = 0
     AND COALESCE(ca.sessions_completed, 0) > 0
    THEN true
    ELSE false
  END AS council_complete,
  COALESCE(qa.approved_questions, 0) AS approved_questions,
  COALESCE(qa.total_questions, 0) AS total_questions,
  COALESCE(ja.jobs_pending, 0) AS jobs_pending,
  COALESCE(ja.jobs_processing, 0) AS jobs_processing,
  COALESCE(ja.jobs_failed, 0) AS jobs_failed,
  ja.last_job_completed_at,
  ja.last_job_error,
  -- has_stale_publish
  CASE
    WHEN cp.status <> 'published' AND cp.published_at IS NOT NULL THEN true
    ELSE false
  END AS has_stale_publish,
  -- HARDENED is_stuck: greatest across ALL activity sources
  CASE
    WHEN cp.status IN ('building','council_review')
     AND greatest(
       coalesce(cp.last_progress_at, 'epoch'::timestamptz),
       coalesce(ja.last_job_activity_at, 'epoch'::timestamptz),
       coalesce(ca.last_council_activity_at, 'epoch'::timestamptz),
       cp.updated_at
     ) < now() - interval '30 minutes'
    THEN true
    ELSE false
  END AS is_stuck,
  -- NEW: has_publish_drift (published but content gates not met)
  CASE
    WHEN cp.status = 'published' AND COALESCE(qa.approved_questions, 0) < 100 THEN true
    WHEN cp.status = 'published' AND cp.integrity_passed IS NOT TRUE THEN true
    ELSE false
  END AS has_publish_drift
FROM public.course_packages cp
LEFT JOIN public.v_course_display_ssot vd ON vd.package_id = cp.id
LEFT JOIN council_agg ca ON ca.package_id = cp.id
LEFT JOIN job_agg ja ON ja.package_id = cp.id
LEFT JOIN question_agg qa ON qa.package_id = cp.id
WHERE cp.status <> 'archived';

-- 3. Recreate v_admin_queue_ssot with batch_pending/running health signals
DROP VIEW IF EXISTS public.v_admin_queue_ssot CASCADE;

CREATE VIEW public.v_admin_queue_ssot AS
SELECT
  jq.id AS job_id,
  jq.job_type,
  jq.status AS job_status,
  jq.package_id,
  cp.title AS package_title,
  cp.status AS package_status,
  jq.priority,
  jq.attempts,
  jq.max_attempts,
  jq.run_after,
  jq.locked_at,
  jq.locked_by,
  jq.started_at,
  jq.completed_at,
  jq.last_error,
  jq.created_at,
  jq.updated_at,
  jq.meta,
  CASE
    WHEN jq.status IN ('processing','running','batch_pending')
     AND jq.started_at < now() - interval '15 minutes'
    THEN 'zombie'
    WHEN jq.status IN ('processing','running','batch_pending')
     AND jq.locked_at < now() - interval '10 minutes'
    THEN 'stale_lock'
    WHEN jq.status = 'failed' AND jq.attempts >= jq.max_attempts
    THEN 'exhausted'
    WHEN jq.status IN ('pending','queued')
     AND jq.created_at < now() - interval '2 hours'
    THEN 'aging'
    ELSE 'ok'
  END AS health_signal,
  EXTRACT(EPOCH FROM (now() - jq.created_at)) / 60 AS age_minutes
FROM public.job_queue jq
LEFT JOIN public.course_packages cp ON cp.id = jq.package_id
WHERE jq.status IN ('pending','queued','processing','running','batch_pending','failed')
ORDER BY
  CASE jq.status
    WHEN 'failed' THEN 1
    WHEN 'processing' THEN 2
    WHEN 'running' THEN 3
    WHEN 'batch_pending' THEN 4
    WHEN 'pending' THEN 5
    WHEN 'queued' THEN 6
    ELSE 99
  END,
  jq.priority ASC NULLS LAST,
  jq.created_at ASC;
