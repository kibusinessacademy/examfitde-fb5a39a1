
-- Reset domain_imported_at for exam_pool batches so the fixed importer can retry
UPDATE llm_batch_requests
SET domain_imported_at = NULL
WHERE batch_id IN (
  SELECT id FROM llm_batches 
  WHERE job_type = 'exam_pool_generate' AND status = 'completed'
    AND model = 'gpt-4o-mini'
)
AND domain_imported_at IS NOT NULL;

-- Reset batch-level domain import markers for exam_pool
UPDATE llm_batches
SET domain_import_completed_at = NULL, domain_import_error = NULL
WHERE job_type = 'exam_pool_generate' AND status = 'completed'
  AND model = 'gpt-4o-mini'
  AND domain_import_completed_at IS NOT NULL;

-- Also reset lesson_generate_content batches that had import errors
UPDATE llm_batch_requests
SET domain_imported_at = NULL
WHERE batch_id IN (
  SELECT id FROM llm_batches 
  WHERE job_type = 'lesson_generate_content' AND status = 'completed'
    AND model = 'gpt-4o-mini'
    AND domain_import_error IS NOT NULL
)
AND domain_imported_at IS NOT NULL;

UPDATE llm_batches
SET domain_import_completed_at = NULL, domain_import_error = NULL
WHERE job_type = 'lesson_generate_content' AND status = 'completed'
  AND model = 'gpt-4o-mini'
  AND domain_import_error IS NOT NULL;
