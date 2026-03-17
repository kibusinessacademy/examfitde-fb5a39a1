
-- Reset domain_imported_at again for the batch we just tested
UPDATE llm_batch_requests
SET domain_imported_at = NULL
WHERE batch_id = 'edeebaab-fbe9-4eb6-ae4d-aa4fbd985f51';

UPDATE llm_batches
SET domain_import_completed_at = NULL, domain_import_error = NULL
WHERE id = 'edeebaab-fbe9-4eb6-ae4d-aa4fbd985f51';
