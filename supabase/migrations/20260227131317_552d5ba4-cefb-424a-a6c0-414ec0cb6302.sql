-- ═══════════════════════════════════════════════════════════════
-- PATCH D: Idempotency & Dupe-Prevention
-- ═══════════════════════════════════════════════════════════════

-- Prevent duplicate pending/processing jobs per job_type+package_id
CREATE UNIQUE INDEX IF NOT EXISTS job_queue_unique_active_job
ON public.job_queue (job_type, package_id)
WHERE status IN ('pending','processing')
  AND package_id IS NOT NULL;

-- Prevent duplicate global jobs (no package_id)
CREATE UNIQUE INDEX IF NOT EXISTS job_queue_unique_global_job
ON public.job_queue (job_type)
WHERE status IN ('pending','processing')
  AND package_id IS NULL;

-- Idempotency key column for explicit dupe control
ALTER TABLE public.job_queue
ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS job_queue_idempotency_unique
ON public.job_queue (idempotency_key)
WHERE idempotency_key IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- PATCH E: Pool Observability Views
-- ═══════════════════════════════════════════════════════════════

-- 1) Pool Health Overview
CREATE OR REPLACE VIEW public.job_pool_health AS
SELECT
  worker_pool,
  status,
  count(*) AS cnt,
  min(created_at) AS oldest_job,
  max(updated_at) AS newest_update
FROM public.job_queue
GROUP BY worker_pool, status;

-- 2) Processing Age (Zombie Detection)
CREATE OR REPLACE VIEW public.job_processing_age AS
SELECT
  id,
  worker_pool,
  job_type,
  now() - started_at AS running_for,
  attempts,
  last_error
FROM public.job_queue
WHERE status = 'processing';

-- 3) Error Dashboard (last 24h)
CREATE OR REPLACE VIEW public.job_error_stats_24h AS
SELECT
  worker_pool,
  job_type,
  left(last_error, 200) AS last_error_preview,
  count(*) AS cnt
FROM public.job_queue
WHERE status = 'failed'
  AND updated_at > now() - interval '24 hours'
GROUP BY worker_pool, job_type, left(last_error, 200)
ORDER BY cnt DESC;