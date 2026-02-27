-- Phase 3: Blocked jobs visibility views (job_queue meta only, no package_steps dependency)

CREATE OR REPLACE VIEW public.job_artifact_blocks AS
SELECT
  jq.id AS job_id,
  jq.worker_pool,
  jq.job_type,
  jq.package_id,
  (jq.meta->>'blocked_by_artifact')::text AS blocked_by_artifact,
  (jq.meta->>'blocked_by_producer')::text AS blocked_by_producer,
  (jq.meta->>'artifact_block_count')::int AS block_count,
  (jq.meta->>'artifact_blocked')::boolean AS artifact_blocked,
  (jq.meta->>'artifact_blocked_since')::timestamptz AS blocked_since,
  (jq.meta->>'artifact_blocked_backoff_ms')::int AS backoff_ms,
  jq.run_after,
  jq.updated_at,
  left(coalesce(jq.last_error, ''), 200) AS last_error_200
FROM public.job_queue jq
WHERE jq.status = 'pending'
  AND (jq.meta ? 'blocked_by_artifact')
ORDER BY (jq.meta->>'artifact_blocked')::boolean DESC NULLS LAST,
         (jq.meta->>'artifact_block_count')::int DESC NULLS LAST,
         jq.updated_at DESC;

-- Phase 3: Top blockers aggregation
CREATE OR REPLACE VIEW public.job_artifact_blockers_top AS
SELECT
  worker_pool,
  blocked_by_artifact,
  count(*) AS pending_jobs,
  count(*) FILTER (WHERE artifact_blocked) AS blocked_mode_jobs,
  min(updated_at) AS oldest_updated_at,
  max(updated_at) AS newest_updated_at
FROM public.job_artifact_blocks
GROUP BY worker_pool, blocked_by_artifact
ORDER BY blocked_mode_jobs DESC, pending_jobs DESC;