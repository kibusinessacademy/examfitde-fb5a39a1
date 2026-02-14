
-- 1) Monitoring View: pipeline_health
CREATE OR REPLACE VIEW public.pipeline_health AS
SELECT
  (SELECT count(*) FROM public.package_leases WHERE lease_until > now()) AS active_leases,
  (SELECT count(*) FROM public.package_steps WHERE status = 'running') AS running_steps,
  (SELECT count(*) FROM public.course_packages WHERE status = 'queued') AS queued_packages,
  (SELECT count(*) FROM public.course_packages WHERE status = 'building') AS building_packages,
  (SELECT count(*) FROM public.course_packages WHERE status = 'failed') AS failed_packages,
  (SELECT count(*) FROM public.course_packages WHERE status = 'done') AS done_packages,
  (SELECT count(*) FROM public.course_packages WHERE status = 'blocked') AS blocked_packages;

-- 2) Max Attempts optimieren (weniger Retries = schnellere Factory)
UPDATE public.package_steps SET max_attempts = 3 WHERE step_key = 'scaffold_learning_course' AND max_attempts != 3;
UPDATE public.package_steps SET max_attempts = 3 WHERE step_key = 'generate_exam_pool' AND max_attempts != 3;
UPDATE public.package_steps SET max_attempts = 2 WHERE step_key = 'generate_oral_exam' AND max_attempts != 2;
UPDATE public.package_steps SET max_attempts = 2 WHERE step_key = 'build_ai_tutor_index' AND max_attempts != 2;
UPDATE public.package_steps SET max_attempts = 2 WHERE step_key = 'generate_handbook' AND max_attempts != 2;
UPDATE public.package_steps SET max_attempts = 2 WHERE step_key = 'run_integrity_check' AND max_attempts != 2;
UPDATE public.package_steps SET max_attempts = 2 WHERE step_key = 'quality_council' AND max_attempts != 2;
UPDATE public.package_steps SET max_attempts = 1 WHERE step_key = 'auto_publish' AND max_attempts != 1;

-- 3) Alte Cron-Jobs deaktivieren (zwei Runner = Chaos)
SELECT cron.unschedule('package-queue-next-cron');
SELECT cron.unschedule('auto-pipeline-queue-next');
