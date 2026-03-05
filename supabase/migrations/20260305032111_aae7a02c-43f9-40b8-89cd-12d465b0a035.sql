
-- Reset failed lesson jobs one per curriculum scope using DISTINCT ON
UPDATE job_queue
SET status = 'pending',
    attempts = 0,
    last_error = null,
    error = null,
    started_at = null,
    completed_at = null,
    locked_by = null,
    locked_at = null,
    max_attempts = 8,
    updated_at = now()
WHERE id IN (
  SELECT DISTINCT ON (
    payload->>'curriculum_id',
    COALESCE(payload->>'learning_field_filter','__root__')
  ) id
  FROM job_queue
  WHERE job_type = 'lesson_generate_content'
    AND status = 'failed'
    AND NOT EXISTS (
      SELECT 1 FROM job_queue active
      WHERE active.job_type = 'lesson_generate_content'
        AND active.status IN ('pending','queued','processing')
        AND active.payload->>'curriculum_id' = job_queue.payload->>'curriculum_id'
        AND COALESCE(active.payload->>'learning_field_filter','__root__') = COALESCE(job_queue.payload->>'learning_field_filter','__root__')
    )
  ORDER BY payload->>'curriculum_id', COALESCE(payload->>'learning_field_filter','__root__'), updated_at DESC
);
