
-- One-time cleanup: reset stale processing jobs with backoff
WITH stale AS (
  SELECT id, attempts, max_attempts
  FROM public.job_queue
  WHERE status = 'processing'
    AND (now() - COALESCE(updated_at, locked_at, now())) > interval '5 minutes'
)
UPDATE public.job_queue j SET
  status = CASE WHEN (s.attempts + 1) >= COALESCE(s.max_attempts, 8) THEN 'failed' ELSE 'pending' END,
  locked_at = NULL,
  locked_by = NULL,
  attempts = s.attempts + 1,
  run_after = CASE WHEN (s.attempts + 1) >= COALESCE(s.max_attempts, 8) THEN NULL
              ELSE (now() + LEAST((s.attempts + 1) * interval '30 seconds', interval '5 minutes')) END,
  updated_at = now(),
  last_error = CASE WHEN (s.attempts + 1) >= COALESCE(s.max_attempts, 8)
    THEN 'STALE_LOCK_CLEANUP: exhausted after ' || (s.attempts + 1) || ' attempts'
    ELSE 'STALE_LOCK_CLEANUP: reset with backoff (attempt ' || (s.attempts + 1) || '/' || COALESCE(s.max_attempts, 8) || ')'
  END
FROM stale s
WHERE j.id = s.id;
