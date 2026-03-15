
-- Domain import tracking on llm_batch_requests
ALTER TABLE public.llm_batch_requests
  ADD COLUMN IF NOT EXISTS domain_imported_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_llm_batch_requests_domain_imported
  ON public.llm_batch_requests(batch_id)
  WHERE domain_imported_at IS NULL AND status = 'completed';

-- Domain import tracking on llm_batches
ALTER TABLE public.llm_batches
  ADD COLUMN IF NOT EXISTS domain_import_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS domain_import_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS domain_import_error text;

-- Update overview view
DROP VIEW IF EXISTS public.v_llm_batch_overview;

CREATE VIEW public.v_llm_batch_overview AS
SELECT
  b.id,
  b.provider,
  b.job_type,
  b.model,
  b.status,
  b.request_count,
  b.completed_count,
  b.failed_count,
  b.provider_batch_id,
  b.input_file_id,
  b.output_file_id,
  b.error_file_id,
  b.submitted_at,
  b.completed_at,
  b.last_polled_at,
  b.results_imported_at,
  b.output_imported_at,
  b.error_imported_at,
  b.import_attempts,
  b.poll_error_count,
  b.last_poll_error,
  b.next_poll_after,
  b.domain_import_started_at,
  b.domain_import_completed_at,
  b.domain_import_error,
  b.created_at,
  b.updated_at
FROM public.llm_batches b;
