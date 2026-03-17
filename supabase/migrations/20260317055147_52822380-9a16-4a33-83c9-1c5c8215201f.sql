-- Reset domain_import_started_at for lesson_generate_content batches
-- that were marked by cleanup migration but never actually imported.
-- This allows batch-poll to re-trigger the batch-result-importer.
UPDATE llm_batches
SET domain_import_started_at = NULL
WHERE job_type = 'lesson_generate_content'
  AND model = 'gpt-4o-mini'
  AND status = 'completed'
  AND results_imported_at IS NOT NULL
  AND domain_import_completed_at IS NULL
  AND domain_import_started_at IS NOT NULL;