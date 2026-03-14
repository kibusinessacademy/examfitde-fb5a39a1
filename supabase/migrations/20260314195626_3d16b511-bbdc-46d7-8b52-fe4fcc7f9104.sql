
-- Step 1: Cancel pending jobs that have a failed duplicate (to free idempotency slot)
WITH conflicting AS (
  SELECT f.idempotency_key
  FROM public.job_queue f
  WHERE f.status = 'failed' AND f.idempotency_key IS NOT NULL
  INTERSECT
  SELECT p.idempotency_key
  FROM public.job_queue p
  WHERE p.status = 'pending' AND p.idempotency_key IS NOT NULL
)
UPDATE public.job_queue
SET status = 'cancelled', updated_at = now()
WHERE status = 'pending' AND idempotency_key IN (SELECT idempotency_key FROM conflicting);
