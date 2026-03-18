-- REVIVE: Nur Jobs ohne Idempotenz-Kollision
-- Erst die kollidierenden cancellen, dann reviven
WITH false_kills AS (
  SELECT jq.id, jq.idempotency_key
  FROM public.job_queue jq
  JOIN public.course_packages cp ON cp.id = jq.package_id
  WHERE jq.status = 'failed'
    AND jq.last_error LIKE '%OPS_GUARD:NON_BUILDING_PACKAGE%'
    AND cp.status = 'building'
    AND jq.updated_at > now() - interval '6 hours'
),
has_active_dup AS (
  SELECT fk.id
  FROM false_kills fk
  WHERE fk.idempotency_key IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.job_queue jq2
      WHERE jq2.idempotency_key = fk.idempotency_key
        AND jq2.status IN ('pending', 'processing')
        AND jq2.id <> fk.id
    )
),
revivable AS (
  SELECT fk.id FROM false_kills fk
  WHERE fk.id NOT IN (SELECT id FROM has_active_dup)
)
UPDATE public.job_queue jq
SET status = 'pending',
    error = null,
    last_error = null,
    completed_at = null,
    locked_at = null,
    locked_by = null,
    updated_at = now(),
    meta = coalesce(jq.meta, '{}'::jsonb) || jsonb_build_object(
      'revived_from', 'ops_hygiene_false_kill',
      'revived_at', now()
    )
FROM revivable r
WHERE jq.id = r.id;

-- Log
INSERT INTO public.auto_heal_log (action_type, trigger_source, target_type, result_status, result_detail)
VALUES (
  'hygiene_false_kill_revival',
  'migration_fix',
  'job_queue',
  'applied',
  'Revived falsely killed jobs (skipped those with active duplicates). Fixed ops_hygiene_cleanup whitelist.'
);