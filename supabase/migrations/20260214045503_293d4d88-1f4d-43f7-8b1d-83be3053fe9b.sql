
-- Add retry_count to course_packages if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'course_packages' AND column_name = 'retry_count'
  ) THEN
    ALTER TABLE public.course_packages ADD COLUMN retry_count integer DEFAULT 0;
  END IF;
END $$;
