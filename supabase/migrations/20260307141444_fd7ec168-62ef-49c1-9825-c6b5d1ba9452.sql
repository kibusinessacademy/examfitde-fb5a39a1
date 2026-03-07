-- Clear stale error states on building packages
-- 1) "lessons empty" on exam_pool steps (lessons are now filled, 0 empty confirmed)
UPDATE public.package_steps
SET last_error = NULL, updated_at = now()
WHERE package_id IN (
  '0f372cf6-76fd-45a5-b161-685115f202bb',
  '772e30cf-f6a5-4869-9a97-2b5dfdaa2cb1',
  '047bc325-5244-4f21-affd-5395bf62bcff'
)
AND step_key = 'generate_exam_pool'
AND last_error LIKE '%lessons empty%';

-- 2) MFA: sequence guard stale (validate_learning_content IS done)
UPDATE public.package_steps
SET last_error = NULL, updated_at = now()
WHERE package_id = '11b697be-07a8-4164-ab1b-a8747ec49b03'
AND step_key = 'generate_lesson_minichecks'
AND last_error LIKE '%validate_learning_content not done%';

-- 3) Pharma: sequence guard stale on elite_harden
UPDATE public.package_steps
SET last_error = NULL, updated_at = now()
WHERE package_id = '62b52784-6d73-458a-9196-631091877c26'
AND step_key = 'elite_harden'
AND last_error LIKE '%validate_learning_content not done%';

-- 4) Cancel stale failed jobs so runner can re-enqueue
UPDATE public.job_queue
SET status = 'cancelled', updated_at = now()
WHERE status = 'failed'
AND package_id IN (
  SELECT id FROM public.course_packages WHERE status = 'building'
)
AND updated_at < now() - interval '6 hours';