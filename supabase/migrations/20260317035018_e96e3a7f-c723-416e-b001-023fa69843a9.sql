
-- Reset ALL lesson_generate_content batches for re-import
UPDATE llm_batches
SET domain_import_completed_at = NULL, domain_import_error = NULL
WHERE job_type = 'lesson_generate_content' AND status = 'completed'
  AND model = 'gpt-4o-mini';

UPDATE llm_batch_requests
SET domain_imported_at = NULL
WHERE batch_id IN (
  SELECT id FROM llm_batches 
  WHERE job_type = 'lesson_generate_content' AND status = 'completed'
    AND model = 'gpt-4o-mini'
);
