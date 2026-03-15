
ALTER TABLE public.llm_batches
  ADD COLUMN IF NOT EXISTS import_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_imported_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_imported_at timestamptz;

-- Update the overview view to include new columns
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
  b.created_at,
  b.updated_at
FROM public.llm_batches b;
