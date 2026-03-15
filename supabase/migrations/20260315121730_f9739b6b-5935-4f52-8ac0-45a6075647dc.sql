
-- Fix source_ref column: TEXT → JSONB for structured source references
ALTER TABLE public.llm_batch_requests
  ALTER COLUMN source_ref TYPE jsonb USING
    CASE
      WHEN source_ref IS NULL THEN NULL
      WHEN source_ref ~ '^\s*\{' THEN source_ref::jsonb
      ELSE jsonb_build_object('raw', source_ref)
    END;
