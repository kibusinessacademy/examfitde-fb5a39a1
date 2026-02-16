
-- 1. Add missing metadata column to handbook_sections (edge function writes it)
ALTER TABLE public.handbook_sections
ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

-- 2. Add missing quality_report column to course_packages (auto_publish reads it)
ALTER TABLE public.course_packages
ADD COLUMN IF NOT EXISTS quality_report jsonb;

-- 3. Add missing pipeline steps for this package
INSERT INTO public.package_steps (package_id, step_key, status, attempts, max_attempts, timeout_seconds)
VALUES 
  ('c25f9ee0-518f-44d2-ac49-72f6731608a2', 'auto_seed_exam_blueprints', 'done', 1, 3, 600),
  ('c25f9ee0-518f-44d2-ac49-72f6731608a2', 'quality_council', 'queued', 0, 3, 600)
ON CONFLICT (package_id, step_key) DO NOTHING;

-- 4. Set certification_id on the package (use beruf_id as fallback since no catalog entry exists)
UPDATE public.course_packages
SET certification_id = '52f78e37-4763-46cf-a31d-7aa173194b7a'
WHERE id = 'c25f9ee0-518f-44d2-ac49-72f6731608a2'
AND certification_id IS NULL;

-- 5. Reset stale lease
DELETE FROM public.package_leases
WHERE package_id = 'c25f9ee0-518f-44d2-ac49-72f6731608a2';

-- 6. Reset stuck build_ai_tutor_index step
UPDATE public.package_steps
SET status = 'queued', job_id = NULL, runner_id = NULL, started_at = NULL, attempts = 0
WHERE package_id = 'c25f9ee0-518f-44d2-ac49-72f6731608a2'
AND step_key = 'build_ai_tutor_index';

-- 7. Reset the stale job
UPDATE public.job_queue
SET status = 'cancelled'
WHERE id = 'cdc628c7-ce4b-4119-afb7-fb976b4d1f1a';
