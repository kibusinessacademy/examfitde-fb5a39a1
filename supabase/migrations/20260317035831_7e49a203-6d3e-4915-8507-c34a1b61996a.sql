
-- Reset a lesson batch for re-test
UPDATE llm_batches
SET domain_import_completed_at = NULL, domain_import_error = NULL
WHERE id = '413f7a73-7c4e-4b91-a26a-29c0f889e54a';

UPDATE llm_batch_requests
SET domain_imported_at = NULL
WHERE batch_id = '413f7a73-7c4e-4b91-a26a-29c0f889e54a';
