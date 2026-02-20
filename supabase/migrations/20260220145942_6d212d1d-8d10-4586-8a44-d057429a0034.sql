-- Prevent pending/processing jobs without package_id (system jobs like batch_curriculum_pipeline 
-- should transition through pending quickly or use a dedicated queue)
-- Use a validation trigger instead of CHECK constraint for flexibility

CREATE OR REPLACE FUNCTION public.validate_job_queue_package_id()
RETURNS TRIGGER AS $$
BEGIN
  -- Only enforce for job_types that are package-scoped (prefix 'package_' or known pipeline steps)
  IF NEW.status IN ('pending', 'processing')
     AND NEW.package_id IS NULL
     AND (
       NEW.job_type LIKE 'package_%'
       OR NEW.job_type IN (
         'generate_learning_content',
         'validate_learning_content', 
         'auto_seed_exam_blueprints',
         'validate_blueprints',
         'generate_exam_pool',
         'validate_exam_pool',
         'generate_oral_exam',
         'validate_oral_exam',
         'build_ai_tutor_index',
         'validate_tutor_index',
         'generate_handbook',
         'validate_handbook',
         'run_integrity_check',
         'quality_council',
         'auto_publish',
         'scaffold_learning_course',
         'auto_gap_close'
       )
     )
  THEN
    -- Try to backfill from payload before rejecting
    IF NEW.payload IS NOT NULL AND (NEW.payload->>'package_id') IS NOT NULL THEN
      NEW.package_id := (NEW.payload->>'package_id')::uuid;
    ELSE
      RAISE EXCEPTION 'Package-scoped job % requires package_id (status: %)', NEW.job_type, NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply on INSERT and UPDATE
DROP TRIGGER IF EXISTS trg_validate_job_package_id ON public.job_queue;
CREATE TRIGGER trg_validate_job_package_id
  BEFORE INSERT OR UPDATE ON public.job_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_job_queue_package_id();