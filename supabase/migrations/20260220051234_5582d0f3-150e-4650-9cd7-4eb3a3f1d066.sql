-- OPS: Missing monitoring views + course build progress with stuck detection

-- 1) Batch Requeue Summary
CREATE OR REPLACE VIEW public.ops_batch_requeue_summary AS
SELECT
  job_type,
  count(*) AS requeues,
  min(updated_at) AS first_seen,
  max(updated_at) AS last_seen,
  count(*) FILTER (WHERE batch_cursor IS NULL) AS cursor_null,
  count(DISTINCT batch_cursor::text) AS distinct_cursors
FROM public.job_queue
WHERE updated_at > now() - interval '6 hours'
  AND status = 'pending'
  AND (
    error ILIKE '%batch%'
    OR batch_cursor IS NOT NULL
  )
GROUP BY job_type
ORDER BY requeues DESC;

-- 2) Package Steps Stuck (using correct enum values: queued, enqueued, running)
CREATE OR REPLACE VIEW public.ops_package_steps_stuck AS
SELECT
  ps.package_id,
  cp.title,
  ps.step_key,
  ps.status::text AS status,
  ps.attempts,
  ps.updated_at,
  ps.last_error
FROM public.package_steps ps
JOIN public.course_packages cp ON cp.id = ps.package_id
WHERE ps.status IN ('queued','enqueued','running')
ORDER BY ps.updated_at ASC;

-- 3) Prereq Guard Cancelled
CREATE OR REPLACE VIEW public.ops_prereq_guard_cancelled AS
SELECT
  job_type,
  count(*) AS cancelled,
  min(updated_at) AS first_seen,
  max(updated_at) AS last_seen,
  max(error) AS sample_error
FROM public.job_queue
WHERE updated_at > now() - interval '6 hours'
  AND status = 'cancelled'
  AND error ILIKE '%prereq%'
GROUP BY job_type
ORDER BY cancelled DESC;

-- 4) Course Build Progress with stuck detection
CREATE OR REPLACE VIEW public.ops_course_build_progress AS
WITH open_jobs AS (
  SELECT
    (payload->>'package_id')::uuid AS package_id,
    count(*) FILTER (WHERE status IN ('pending','processing')) AS open_jobs,
    count(*) FILTER (WHERE status='pending') AS pending_jobs,
    count(*) FILTER (WHERE status='processing') AS processing_jobs,
    sum(coalesce(attempts,0)) AS attempts_sum,
    max(updated_at) AS last_job_activity_at
  FROM public.job_queue
  WHERE payload ? 'package_id'
  GROUP BY 1
),
base AS (
  SELECT
    cp.id AS package_id,
    cp.title,
    cp.status AS package_status,
    cp.current_step,
    cp.build_progress,
    cp.last_progress_at,
    cp.updated_at AS package_updated_at,
    cp.last_error,
    coalesce(oj.open_jobs, 0) AS open_jobs,
    coalesce(oj.pending_jobs, 0) AS pending_jobs,
    coalesce(oj.processing_jobs, 0) AS processing_jobs,
    coalesce(oj.attempts_sum, 0) AS attempts_sum,
    oj.last_job_activity_at,
    greatest(
      coalesce(cp.last_progress_at, cp.updated_at),
      coalesce(oj.last_job_activity_at, '1970-01-01'::timestamptz)
    ) AS last_activity_at
  FROM public.course_packages cp
  LEFT JOIN open_jobs oj ON oj.package_id = cp.id
  WHERE cp.status IN ('building','running','stuck','failed','done','published')
)
SELECT
  b.*,
  greatest(0, floor(extract(epoch FROM (now() - b.last_activity_at)) / 60)::int) AS stuck_minutes,
  (
    b.package_status IN ('building','running')
    AND (
      b.last_activity_at < now() - interval '30 minutes'
      OR b.open_jobs = 0
    )
  ) AS is_stuck,
  CASE
    WHEN b.package_status NOT IN ('building','running') THEN NULL
    WHEN b.open_jobs = 0 AND b.last_activity_at < now() - interval '30 minutes'
      THEN 'STARVATION_AND_NO_ACTIVITY_30M'
    WHEN b.open_jobs = 0
      THEN 'STARVATION_NO_OPEN_JOBS'
    WHEN b.last_activity_at < now() - interval '30 minutes'
      THEN 'NO_ACTIVITY_30M'
    WHEN b.processing_jobs > 0 AND b.last_job_activity_at IS NOT NULL
         AND b.last_job_activity_at < now() - interval '15 minutes'
      THEN 'PROCESSING_BUT_JOB_ACTIVITY_STALE_15M'
    ELSE NULL
  END AS stuck_reason
FROM base b
ORDER BY
  CASE
    WHEN (b.package_status IN ('building','running')
      AND (b.last_activity_at < now() - interval '30 minutes' OR b.open_jobs = 0)) THEN 0
    WHEN b.package_status IN ('stuck','failed') THEN 1
    WHEN b.package_status IN ('building','running') THEN 2
    ELSE 3
  END,
  b.last_activity_at ASC;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_job_queue_payload_package_id
  ON public.job_queue USING btree (((payload->>'package_id')));

CREATE INDEX IF NOT EXISTS idx_course_packages_status
  ON public.course_packages (status);