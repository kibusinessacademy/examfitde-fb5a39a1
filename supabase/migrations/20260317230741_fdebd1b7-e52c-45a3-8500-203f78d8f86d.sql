
-- Mark all broken GPT-5.4 batches as failed
-- Root cause: max_tokens param is rejected by GPT-5.x models (requires max_completion_tokens)
-- These batches cannot be recovered and must be resubmitted with the fixed payload
UPDATE llm_batches
SET status = 'failed',
    completed_at = COALESCE(completed_at, NOW()),
    error_summary = jsonb_build_object(
      'root_cause', 'BATCH_MAX_TOKENS_REJECTED',
      'detail', 'GPT-5.4 rejects max_tokens param. Fixed to max_completion_tokens. Batch must be resubmitted.',
      'marked_at', NOW()::text
    ),
    next_poll_after = NULL
WHERE model ILIKE '%5.4%'
  AND status IN ('validating', 'in_progress', 'finalizing', 'completed');

-- Also mark their requests as failed
UPDATE llm_batch_requests
SET status = 'failed',
    completed_at = COALESCE(completed_at, NOW()),
    error_body = jsonb_build_object(
      'code', 'BATCH_MAX_TOKENS_REJECTED',
      'message', 'Parent batch failed: GPT-5.4 rejects max_tokens. Resubmission required.'
    )
WHERE batch_id IN (
  SELECT id FROM llm_batches WHERE model ILIKE '%5.4%'
)
AND status IN ('queued', 'submitted');
