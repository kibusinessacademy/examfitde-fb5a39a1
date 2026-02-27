
-- Fix: Scope idempotency_key unique index to active jobs only
-- Cancelled/failed rows must NOT block re-enqueue (Phase 6 revive)

-- Drop the global unique index (blocks re-enqueue of cancelled producers)
DROP INDEX IF EXISTS public.job_queue_idempotency_unique;

-- Recreate scoped to pending/processing only
-- "Max 1 active instance per idempotency_key" — cancelled is not active
CREATE UNIQUE INDEX job_queue_idempotency_active 
ON public.job_queue (idempotency_key) 
WHERE idempotency_key IS NOT NULL 
  AND status IN ('pending', 'processing');
