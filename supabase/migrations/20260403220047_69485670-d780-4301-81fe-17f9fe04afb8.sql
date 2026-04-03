-- Ops view: shard-aware liveness for generate_learning_content
CREATE OR REPLACE VIEW public.ops_learning_content_shard_liveness AS
WITH shard_stats AS (
  SELECT
    package_id,
    COUNT(*) FILTER (WHERE status IN ('pending', 'claimed')) AS shards_pending,
    COUNT(*) FILTER (WHERE status = 'processing') AS shards_processing,
    COUNT(*) FILTER (WHERE status = 'completed') AS shards_completed,
    COUNT(*) FILTER (WHERE status = 'failed') AS shards_failed,
    COUNT(*) AS shards_total,
    MAX(updated_at) AS last_shard_update_at
  FROM public.package_content_shards
  GROUP BY package_id
),
shard_job_stats AS (
  SELECT
    package_id,
    COUNT(*) FILTER (WHERE status IN ('pending', 'queued')) AS shard_jobs_pending,
    COUNT(*) FILTER (WHERE status = 'processing') AS shard_jobs_processing,
    COUNT(*) FILTER (WHERE status = 'failed') AS shard_jobs_failed,
    MAX(updated_at) AS last_shard_job_at
  FROM public.job_queue
  WHERE job_type = 'lesson_generate_content_shard'
    AND status IN ('pending', 'queued', 'processing', 'failed')
  GROUP BY package_id
),
parent_job_stats AS (
  SELECT
    package_id,
    COUNT(*) FILTER (WHERE status IN ('pending', 'queued')) AS parent_jobs_pending,
    COUNT(*) FILTER (WHERE status = 'processing') AS parent_jobs_processing,
    MAX(updated_at) AS last_parent_job_at
  FROM public.job_queue
  WHERE job_type = 'lesson_generate_content'
    AND status IN ('pending', 'queued', 'processing')
  GROUP BY package_id
)
SELECT
  cp.id AS package_id,
  cp.title,
  cp.status AS package_status,
  ps.status AS step_status,
  COALESCE(ss.shards_pending, 0) AS shards_pending,
  COALESCE(ss.shards_processing, 0) AS shards_processing,
  COALESCE(ss.shards_completed, 0) AS shards_completed,
  COALESCE(ss.shards_failed, 0) AS shards_failed,
  COALESCE(ss.shards_total, 0) AS shards_total,
  COALESCE(sjs.shard_jobs_pending, 0) AS shard_jobs_pending,
  COALESCE(sjs.shard_jobs_processing, 0) AS shard_jobs_processing,
  COALESCE(sjs.shard_jobs_failed, 0) AS shard_jobs_failed,
  COALESCE(pjs.parent_jobs_pending, 0) AS parent_jobs_pending,
  COALESCE(pjs.parent_jobs_processing, 0) AS parent_jobs_processing,
  ss.last_shard_update_at,
  sjs.last_shard_job_at,
  pjs.last_parent_job_at,
  CASE
    -- Active shard jobs → healthy
    WHEN COALESCE(sjs.shard_jobs_pending, 0) + COALESCE(sjs.shard_jobs_processing, 0) > 0
      THEN 'healthy_active'
    -- Parent active, no shards → pre-fanout
    WHEN COALESCE(pjs.parent_jobs_pending, 0) + COALESCE(pjs.parent_jobs_processing, 0) > 0
         AND COALESCE(ss.shards_total, 0) = 0
      THEN 'parent_only_active'
    -- All shards done → ready for finalize
    WHEN COALESCE(ss.shards_total, 0) > 0
         AND COALESCE(ss.shards_pending, 0) + COALESCE(ss.shards_processing, 0) = 0
      THEN 'healthy_idle'
    -- Pending shards but no shard jobs → DEADLOCK
    WHEN COALESCE(ss.shards_pending, 0) + COALESCE(ss.shards_processing, 0) > 0
         AND COALESCE(sjs.shard_jobs_pending, 0) + COALESCE(sjs.shard_jobs_processing, 0) = 0
         AND (ss.last_shard_update_at IS NULL OR ss.last_shard_update_at < now() - interval '15 minutes')
      THEN 'shard_orphaned'
    -- Pending shards but recent activity → stalled (grace)
    WHEN COALESCE(ss.shards_pending, 0) + COALESCE(ss.shards_processing, 0) > 0
         AND COALESCE(sjs.shard_jobs_pending, 0) + COALESCE(sjs.shard_jobs_processing, 0) = 0
      THEN 'stalled'
    -- No shards, no jobs
    ELSE 'fully_idle'
  END AS deadlock_verdict,
  CASE
    WHEN COALESCE(sjs.shard_jobs_pending, 0) + COALESCE(sjs.shard_jobs_processing, 0) > 0
      THEN 'none'
    WHEN COALESCE(pjs.parent_jobs_pending, 0) + COALESCE(pjs.parent_jobs_processing, 0) > 0
         AND COALESCE(ss.shards_total, 0) = 0
      THEN 'none'
    WHEN COALESCE(ss.shards_total, 0) > 0
         AND COALESCE(ss.shards_pending, 0) + COALESCE(ss.shards_processing, 0) = 0
      THEN 'await_finalize'
    WHEN COALESCE(ss.shards_pending, 0) + COALESCE(ss.shards_processing, 0) > 0
         AND COALESCE(sjs.shard_jobs_pending, 0) + COALESCE(sjs.shard_jobs_processing, 0) = 0
         AND (ss.last_shard_update_at IS NULL OR ss.last_shard_update_at < now() - interval '15 minutes')
      THEN 'revive_step'
    ELSE 'none'
  END AS recommended_action
FROM public.course_packages cp
JOIN public.package_steps ps ON ps.package_id = cp.id AND ps.step_key = 'generate_learning_content'
LEFT JOIN shard_stats ss ON ss.package_id = cp.id
LEFT JOIN shard_job_stats sjs ON sjs.package_id = cp.id
LEFT JOIN parent_job_stats pjs ON pjs.package_id = cp.id
WHERE cp.status IN ('building', 'blocked', 'queued')
  AND ps.status NOT IN ('done', 'skipped');