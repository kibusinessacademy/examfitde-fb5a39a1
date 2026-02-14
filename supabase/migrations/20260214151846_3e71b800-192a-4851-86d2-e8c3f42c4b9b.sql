
-- Set default timeout_seconds per step_key
UPDATE public.package_steps
SET timeout_seconds = CASE step_key
  WHEN 'generate_exam_pool' THEN 1800
  WHEN 'generate_handbook' THEN 1200
  WHEN 'generate_oral_exam' THEN 900
  WHEN 'scaffold_learning_course' THEN 900
  WHEN 'build_ai_tutor_index' THEN 600
  WHEN 'run_integrity_check' THEN 600
  WHEN 'quality_council' THEN 600
  WHEN 'auto_publish' THEN 300
  ELSE 600
END
WHERE timeout_seconds IS NULL OR timeout_seconds = 0;

-- Insert new step auto_seed_exam_blueprints for existing packages
INSERT INTO public.package_steps (package_id, step_key, status, max_attempts, timeout_seconds)
SELECT ps.package_id, 'auto_seed_exam_blueprints', 
  CASE WHEN ps.status IN ('done'::step_status,'skipped'::step_status) THEN 'done'::step_status ELSE 'queued'::step_status END,
  3,
  600
FROM public.package_steps ps
WHERE ps.step_key = 'generate_exam_pool'
  AND NOT EXISTS (
    SELECT 1 FROM public.package_steps ps2
    WHERE ps2.package_id = ps.package_id AND ps2.step_key = 'auto_seed_exam_blueprints'
  )
ON CONFLICT DO NOTHING;

-- Update compat view to include new step
CREATE OR REPLACE VIEW public.course_package_build_steps AS
SELECT
  ps.package_id,
  ps.step_key,
  ps.status::text AS status,
  ps.attempts,
  ps.max_attempts,
  ps.timeout_seconds,
  ps.started_at,
  ps.finished_at,
  ps.last_heartbeat_at,
  ps.runner_id,
  ps.last_error,
  ps.meta,
  CASE ps.step_key
    WHEN 'scaffold_learning_course' THEN 1
    WHEN 'auto_seed_exam_blueprints' THEN 2
    WHEN 'generate_exam_pool' THEN 3
    WHEN 'generate_oral_exam' THEN 4
    WHEN 'build_ai_tutor_index' THEN 5
    WHEN 'generate_handbook' THEN 6
    WHEN 'run_integrity_check' THEN 7
    WHEN 'quality_council' THEN 8
    WHEN 'auto_publish' THEN 9
    ELSE 999
  END AS sort_order,
  ps.created_at,
  ps.updated_at
FROM public.package_steps ps;

GRANT SELECT ON public.course_package_build_steps TO authenticated;
