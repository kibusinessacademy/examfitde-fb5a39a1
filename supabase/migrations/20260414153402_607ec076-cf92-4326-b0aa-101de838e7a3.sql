
UPDATE job_queue
SET status = 'pending',
    locked_by = NULL,
    locked_at = NULL,
    attempts = COALESCE(attempts, 0),
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'transition_source', 'migration_reset_post_trigger_fix',
      'transition_reason', 'Jobs completed work but failed to persist status due to enum bug - now fixed',
      'transition_at', now()::text
    ),
    updated_at = now()
WHERE status = 'processing'
  AND job_type = 'package_scaffold_learning_course'
  AND id IN (
    'b5e5a0b9-269d-433a-8c4c-04b76d8a8ddf',
    'd1d6790a-2f91-4491-840d-1567337bbb5c',
    'c2ff84c0-b1ea-4a2e-ab23-3408fcd716a8',
    'dc58288f-9a41-4a1e-803b-c09a351e068b',
    '40f9ac8d-76c6-4bc2-90dc-49a202ccc07d'
  );
