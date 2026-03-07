
-- Härtungspunkt 2: Stale-job revive NUR für lease-lost jobs
UPDATE job_queue jq
SET status = 'pending',
    locked_by = NULL,
    locked_at = NULL,
    updated_at = now(),
    meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
      'auto_revived', true,
      'revived_at', now()::text,
      'revive_reason', 'stale_processing_no_lock'
    )
WHERE jq.status = 'processing'
  AND jq.updated_at < now() - interval '5 minutes'
  AND (
    jq.locked_at IS NULL
    OR jq.locked_at < now() - interval '5 minutes'
  );
