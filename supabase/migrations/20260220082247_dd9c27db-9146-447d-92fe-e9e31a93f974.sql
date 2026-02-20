
-- 1) Fix false-positive forensik view: only flag enqueued/running steps missing a job
--    (queued = normal future state, NOT an error)
CREATE OR REPLACE VIEW public.ops_queued_steps_missing_job AS
SELECT ps.package_id,
    cp.title,
    ps.step_key,
    ps.status::text AS step_status,
    ps.updated_at AS step_updated_at,
    CASE
        WHEN ps.step_key = 'generate_handbook' THEN 'package_generate_handbook'
        WHEN ps.step_key = 'validate_handbook' THEN 'package_validate_handbook'
        WHEN ps.step_key = 'generate_exam_pool' THEN 'package_generate_exam_pool'
        WHEN ps.step_key = 'validate_exam_pool' THEN 'package_validate_exam_pool'
        WHEN ps.step_key = 'generate_oral_exam' THEN 'package_generate_oral_exam'
        WHEN ps.step_key = 'validate_oral_exam' THEN 'package_validate_oral_exam'
        WHEN ps.step_key = 'generate_learning_content' THEN 'package_generate_learning_content'
        WHEN ps.step_key = 'validate_learning_content' THEN 'package_validate_learning_content'
        WHEN ps.step_key = 'build_ai_tutor_index' THEN 'package_build_ai_tutor_index'
        WHEN ps.step_key = 'validate_tutor_index' THEN 'package_validate_tutor_index'
        WHEN ps.step_key = 'auto_seed_exam_blueprints' THEN 'package_auto_seed_exam_blueprints'
        WHEN ps.step_key = 'validate_blueprints' THEN 'package_validate_blueprints'
        WHEN ps.step_key = 'scaffold_learning_course' THEN 'package_scaffold_learning_course'
        WHEN ps.step_key = 'run_integrity_check' THEN 'package_run_integrity_check'
        WHEN ps.step_key = 'quality_council' THEN 'package_quality_council'
        WHEN ps.step_key = 'auto_publish' THEN 'package_auto_publish'
        ELSE 'package_' || ps.step_key
    END AS expected_job_type
FROM package_steps ps
JOIN course_packages cp ON cp.id = ps.package_id
WHERE ps.status::text IN ('enqueued', 'running')
  AND NOT EXISTS (
    SELECT 1 FROM job_queue jq
    WHERE (jq.payload->>'package_id') = ps.package_id::text
      AND jq.status IN ('pending', 'processing')
      AND jq.job_type = CASE
          WHEN ps.step_key = 'generate_handbook' THEN 'package_generate_handbook'
          WHEN ps.step_key = 'validate_handbook' THEN 'package_validate_handbook'
          WHEN ps.step_key = 'generate_exam_pool' THEN 'package_generate_exam_pool'
          WHEN ps.step_key = 'validate_exam_pool' THEN 'package_validate_exam_pool'
          WHEN ps.step_key = 'generate_oral_exam' THEN 'package_generate_oral_exam'
          WHEN ps.step_key = 'validate_oral_exam' THEN 'package_validate_oral_exam'
          WHEN ps.step_key = 'generate_learning_content' THEN 'package_generate_learning_content'
          WHEN ps.step_key = 'validate_learning_content' THEN 'package_validate_learning_content'
          WHEN ps.step_key = 'build_ai_tutor_index' THEN 'package_build_ai_tutor_index'
          WHEN ps.step_key = 'validate_tutor_index' THEN 'package_validate_tutor_index'
          WHEN ps.step_key = 'auto_seed_exam_blueprints' THEN 'package_auto_seed_exam_blueprints'
          WHEN ps.step_key = 'validate_blueprints' THEN 'package_validate_blueprints'
          WHEN ps.step_key = 'scaffold_learning_course' THEN 'package_scaffold_learning_course'
          WHEN ps.step_key = 'run_integrity_check' THEN 'package_run_integrity_check'
          WHEN ps.step_key = 'quality_council' THEN 'package_quality_council'
          WHEN ps.step_key = 'auto_publish' THEN 'package_auto_publish'
          ELSE 'package_' || ps.step_key
      END
  );

-- 2) DB Guard: Ensure locked_at is always set when status becomes 'processing'
CREATE OR REPLACE FUNCTION public.guard_locked_at_on_processing()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'processing' AND NEW.locked_at IS NULL THEN
    NEW.locked_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_locked_at ON public.job_queue;
CREATE TRIGGER trg_guard_locked_at
  BEFORE INSERT OR UPDATE ON public.job_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_locked_at_on_processing();
