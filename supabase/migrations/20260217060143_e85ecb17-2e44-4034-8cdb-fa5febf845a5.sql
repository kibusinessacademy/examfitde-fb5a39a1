-- Add validate_exam_pool, validate_oral_exam, validate_handbook steps
-- for all active packages that have the corresponding generator step

-- validate_exam_pool: insert after generate_exam_pool
INSERT INTO public.package_steps (package_id, step_key, status, max_attempts, timeout_seconds)
SELECT ps.package_id, 'validate_exam_pool', 'queued', 5, 300
FROM public.package_steps ps
WHERE ps.step_key = 'generate_exam_pool'
  AND NOT EXISTS (
    SELECT 1 FROM public.package_steps ps2
    WHERE ps2.package_id = ps.package_id AND ps2.step_key = 'validate_exam_pool'
  );

-- validate_oral_exam: insert after generate_oral_exam
INSERT INTO public.package_steps (package_id, step_key, status, max_attempts, timeout_seconds)
SELECT ps.package_id, 'validate_oral_exam', 'queued', 5, 300
FROM public.package_steps ps
WHERE ps.step_key = 'generate_oral_exam'
  AND NOT EXISTS (
    SELECT 1 FROM public.package_steps ps2
    WHERE ps2.package_id = ps.package_id AND ps2.step_key = 'validate_oral_exam'
  );

-- validate_handbook: insert after generate_handbook
INSERT INTO public.package_steps (package_id, step_key, status, max_attempts, timeout_seconds)
SELECT ps.package_id, 'validate_handbook', 'queued', 5, 300
FROM public.package_steps ps
WHERE ps.step_key = 'generate_handbook'
  AND NOT EXISTS (
    SELECT 1 FROM public.package_steps ps2
    WHERE ps2.package_id = ps.package_id AND ps2.step_key = 'validate_handbook'
  );

-- Add qc_status column to exam_questions if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'exam_questions' AND column_name = 'qc_status'
  ) THEN
    ALTER TABLE public.exam_questions ADD COLUMN qc_status text DEFAULT NULL;
  END IF;
END $$;
