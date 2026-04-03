
DROP VIEW IF EXISTS public.ops_learning_content_shard_liveness;

CREATE VIEW public.ops_learning_content_shard_liveness AS
WITH shard_stats AS (
  SELECT
    package_id,
    count(*) FILTER (WHERE status = 'pending')   AS shards_pending,
    count(*) FILTER (WHERE status = 'claimed')    AS shards_claimed,
    count(*) FILTER (WHERE status = 'processing') AS shards_processing,
    count(*) FILTER (WHERE status = 'completed')  AS shards_completed,
    count(*) FILTER (WHERE status = 'failed')     AS shards_failed,
    count(*)                                       AS shards_total,
    max(updated_at)                                AS last_shard_update_at
  FROM package_content_shards
  GROUP BY package_id
),
shard_job_stats AS (
  SELECT
    package_id,
    count(*) FILTER (WHERE status IN ('pending','queued'))  AS shard_jobs_pending,
    count(*) FILTER (WHERE status = 'processing')          AS shard_jobs_processing,
    count(*) FILTER (WHERE status = 'failed')              AS shard_jobs_failed,
    max(updated_at)                                         AS last_shard_job_at
  FROM job_queue
  WHERE job_type = 'lesson_generate_content_shard'
    AND status IN ('pending','queued','processing','failed')
  GROUP BY package_id
),
parent_job_stats AS (
  SELECT
    package_id,
    count(*) FILTER (WHERE status IN ('pending','queued'))  AS parent_jobs_pending,
    count(*) FILTER (WHERE status = 'processing')          AS parent_jobs_processing,
    max(updated_at)                                         AS last_parent_job_at
  FROM job_queue
  WHERE job_type = 'lesson_generate_content'
    AND status IN ('pending','queued','processing')
  GROUP BY package_id
)
SELECT
  cp.id AS package_id,
  cp.title,
  cp.status AS package_status,
  ps.status AS step_status,
  COALESCE(ss.shards_pending, 0)    AS shards_pending,
  COALESCE(ss.shards_claimed, 0)    AS shards_claimed,
  COALESCE(ss.shards_processing, 0) AS shards_processing,
  COALESCE(ss.shards_completed, 0)  AS shards_completed,
  COALESCE(ss.shards_failed, 0)     AS shards_failed,
  COALESCE(ss.shards_total, 0)      AS shards_total,
  COALESCE(sjs.shard_jobs_pending, 0)    AS shard_jobs_pending,
  COALESCE(sjs.shard_jobs_processing, 0) AS shard_jobs_processing,
  COALESCE(sjs.shard_jobs_failed, 0)     AS shard_jobs_failed,
  COALESCE(pjs.parent_jobs_pending, 0)    AS parent_jobs_pending,
  COALESCE(pjs.parent_jobs_processing, 0) AS parent_jobs_processing,
  ss.last_shard_update_at,
  sjs.last_shard_job_at,
  pjs.last_parent_job_at,
  CASE
    WHEN (COALESCE(sjs.shard_jobs_pending,0) + COALESCE(sjs.shard_jobs_processing,0)) > 0
      THEN 'healthy_active'
    WHEN (COALESCE(pjs.parent_jobs_pending,0) + COALESCE(pjs.parent_jobs_processing,0)) > 0
         AND COALESCE(ss.shards_total,0) = 0
      THEN 'parent_only_active'
    WHEN COALESCE(ss.shards_total,0) > 0
         AND (COALESCE(ss.shards_pending,0) + COALESCE(ss.shards_claimed,0) + COALESCE(ss.shards_processing,0)) = 0
      THEN 'healthy_idle'
    WHEN (COALESCE(ss.shards_pending,0) + COALESCE(ss.shards_claimed,0) + COALESCE(ss.shards_processing,0)) > 0
         AND (COALESCE(sjs.shard_jobs_pending,0) + COALESCE(sjs.shard_jobs_processing,0)) = 0
         AND (ss.last_shard_update_at IS NULL OR ss.last_shard_update_at < now() - interval '15 minutes')
      THEN 'shard_orphaned'
    WHEN (COALESCE(ss.shards_pending,0) + COALESCE(ss.shards_claimed,0) + COALESCE(ss.shards_processing,0)) > 0
         AND (COALESCE(sjs.shard_jobs_pending,0) + COALESCE(sjs.shard_jobs_processing,0)) = 0
      THEN 'stalled'
    ELSE 'fully_idle'
  END AS deadlock_verdict,
  CASE
    WHEN (COALESCE(ss.shards_pending,0) + COALESCE(ss.shards_claimed,0) + COALESCE(ss.shards_processing,0)) > 0
         AND (COALESCE(sjs.shard_jobs_pending,0) + COALESCE(sjs.shard_jobs_processing,0)) = 0
         AND (ss.last_shard_update_at IS NULL OR ss.last_shard_update_at < now() - interval '15 minutes')
      THEN true
    ELSE false
  END AS is_deadlocked,
  CASE
    WHEN (COALESCE(sjs.shard_jobs_pending,0) + COALESCE(sjs.shard_jobs_processing,0)) > 0 THEN 'none'
    WHEN (COALESCE(pjs.parent_jobs_pending,0) + COALESCE(pjs.parent_jobs_processing,0)) > 0
         AND COALESCE(ss.shards_total,0) = 0 THEN 'none'
    WHEN COALESCE(ss.shards_total,0) > 0
         AND (COALESCE(ss.shards_pending,0) + COALESCE(ss.shards_claimed,0) + COALESCE(ss.shards_processing,0)) = 0
      THEN 'await_finalize'
    WHEN (COALESCE(ss.shards_pending,0) + COALESCE(ss.shards_claimed,0) + COALESCE(ss.shards_processing,0)) > 0
         AND (COALESCE(sjs.shard_jobs_pending,0) + COALESCE(sjs.shard_jobs_processing,0)) = 0
         AND (ss.last_shard_update_at IS NULL OR ss.last_shard_update_at < now() - interval '15 minutes')
      THEN 'revive_step'
    WHEN (COALESCE(ss.shards_pending,0) + COALESCE(ss.shards_claimed,0) + COALESCE(ss.shards_processing,0)) > 0
         AND (COALESCE(sjs.shard_jobs_pending,0) + COALESCE(sjs.shard_jobs_processing,0)) = 0
      THEN 'monitor_grace'
    ELSE 'none'
  END AS recommended_action
FROM course_packages cp
JOIN package_steps ps ON ps.package_id = cp.id AND ps.step_key = 'generate_learning_content'
LEFT JOIN shard_stats ss ON ss.package_id = cp.id
LEFT JOIN shard_job_stats sjs ON sjs.package_id = cp.id
LEFT JOIN parent_job_stats pjs ON pjs.package_id = cp.id
WHERE cp.status = 'building';
