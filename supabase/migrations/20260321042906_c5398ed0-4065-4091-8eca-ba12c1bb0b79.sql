-- Cleanup: Mark all stuck uploading/draft batches as failed
-- Root cause: batch-submit timed out before OpenAI upload completed

UPDATE llm_batches
SET status = 'failed',
    completed_at = now(),
    error_summary = jsonb_build_object(
      'root_cause', 'STUCK_PRE_SUBMIT',
      'detail', 'batch-submit crashed/timed out before OpenAI upload completed. No provider_batch_id.',
      'original_status', status,
      'stuck_since', created_at::text,
      'remediation_at', now()::text
    )
WHERE status IN ('uploading', 'draft')
  AND created_at < now() - interval '30 minutes';

UPDATE llm_batch_requests
SET status = 'failed',
    completed_at = now(),
    error_body = jsonb_build_object(
      'code', 'BATCH_STUCK_PRE_SUBMIT',
      'message', 'Parent batch never reached OpenAI. Marked as failed during cleanup.'
    )
WHERE batch_id IN (
  SELECT id FROM llm_batches
  WHERE status = 'failed'
    AND (error_summary->>'root_cause') = 'STUCK_PRE_SUBMIT'
)
AND status IN ('queued', 'submitted');

INSERT INTO admin_actions (action, scope, payload)
VALUES (
  'cleanup_stuck_pre_submit_batches',
  'llm_batches',
  jsonb_build_object(
    'description', 'Marked all uploading/draft batches older than 30min as failed',
    'reason', 'batch-submit function timeout/crash before provider upload'
  )
);