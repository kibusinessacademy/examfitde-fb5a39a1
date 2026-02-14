-- FIX 1: Replace legacy table with compat view pointing to package_steps (SSOT)
-- The old table has 76 rows of legacy data that are superseded by package_steps

-- Rename old table to preserve data if needed
ALTER TABLE public.course_package_build_steps RENAME TO course_package_build_steps_legacy;

-- Create compat view
CREATE VIEW public.course_package_build_steps AS
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
    WHEN 'generate_exam_pool' THEN 2
    WHEN 'generate_oral_exam' THEN 3
    WHEN 'build_ai_tutor_index' THEN 4
    WHEN 'generate_handbook' THEN 5
    WHEN 'run_integrity_check' THEN 6
    WHEN 'quality_council' THEN 7
    WHEN 'auto_publish' THEN 8
    ELSE 999
  END AS sort_order,
  ps.created_at,
  ps.updated_at
FROM public.package_steps ps;

GRANT SELECT ON public.course_package_build_steps TO authenticated;
GRANT SELECT ON public.course_package_build_steps TO service_role;