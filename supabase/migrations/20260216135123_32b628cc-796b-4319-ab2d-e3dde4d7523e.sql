
-- Update the course_package_build_steps view to include generate_learning_content
-- at position 2 (after scaffold, before exam blueprints)
CREATE OR REPLACE VIEW public.course_package_build_steps AS
SELECT
    package_id,
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
        WHEN 'scaffold_learning_course' THEN 1
        WHEN 'generate_learning_content' THEN 2
        WHEN 'auto_seed_exam_blueprints' THEN 3
        WHEN 'generate_exam_pool' THEN 4
        WHEN 'generate_oral_exam' THEN 5
        WHEN 'build_ai_tutor_index' THEN 6
        WHEN 'generate_handbook' THEN 7
        WHEN 'run_integrity_check' THEN 8
        WHEN 'quality_council' THEN 9
        WHEN 'auto_publish' THEN 10
        ELSE 999
    END AS sort_order,
    created_at,
    updated_at
FROM package_steps ps;
