-- Unique constraint on oral_exam_sessionsets(package_id) for idempotent upserts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_oral_exam_sessionsets_package_id'
  ) THEN
    ALTER TABLE public.oral_exam_sessionsets
      ADD CONSTRAINT uq_oral_exam_sessionsets_package_id UNIQUE (package_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_oral_exam_sessionsets_package_id
  ON public.oral_exam_sessionsets(package_id);