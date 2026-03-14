
-- For failed jobs with duplicate idempotency keys, keep only newest, cancel rest
WITH ranked_failed AS (
  SELECT id, idempotency_key,
    ROW_NUMBER() OVER (PARTITION BY idempotency_key ORDER BY created_at DESC) as rn
  FROM public.job_queue
  WHERE status = 'failed' AND idempotency_key IS NOT NULL
)
UPDATE public.job_queue
SET status = 'cancelled', updated_at = now()
WHERE id IN (SELECT id FROM ranked_failed WHERE rn > 1);

-- Requeue remaining failed (1 per idempotency_key)
UPDATE public.job_queue
SET status = 'pending',
    attempts = 0,
    error = NULL,
    last_error = NULL,
    locked_by = NULL,
    locked_at = NULL,
    last_heartbeat_at = NULL,
    run_after = now(),
    updated_at = now()
WHERE status = 'failed';

-- Kill stale processing → requeue
UPDATE public.job_queue
SET status = 'pending',
    locked_by = NULL,
    locked_at = NULL,
    last_heartbeat_at = NULL,
    run_after = now(),
    updated_at = now()
WHERE status = 'processing'
  AND (last_heartbeat_at IS NULL OR last_heartbeat_at < now() - interval '5 minutes');

-- Release stale leases
UPDATE public.system_execution_leases
SET released_at = now(),
    status = 'released'
WHERE released_at IS NULL
  AND created_at < now() - interval '10 minutes';

-- Clear provider cooldowns
DELETE FROM public.llm_provider_cooldowns WHERE TRUE;
