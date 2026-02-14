
-- Fix: Recreate course_package_build_steps view with SECURITY INVOKER
-- This ensures RLS policies of the querying user are enforced, not the view creator's.
CREATE OR REPLACE VIEW public.course_package_build_steps
WITH (security_invoker = true)
AS
SELECT package_id,
    step_key,
    status::text AS status,
    attempts,
    max_attempts,
    timeout_seconds,
    started_at,
    finished_at,
    last_heartbeat_at,
    runner_id,
    last_error,
    meta,
    CASE step_key
        WHEN 'scaffold_learning_course'::text THEN 1
        WHEN 'auto_seed_exam_blueprints'::text THEN 2
        WHEN 'generate_exam_pool'::text THEN 3
        WHEN 'generate_oral_exam'::text THEN 4
        WHEN 'build_ai_tutor_index'::text THEN 5
        WHEN 'generate_handbook'::text THEN 6
        WHEN 'run_integrity_check'::text THEN 7
        WHEN 'quality_council'::text THEN 8
        WHEN 'auto_publish'::text THEN 9
        ELSE 999
    END AS sort_order,
    created_at,
    updated_at
FROM package_steps ps;
