
CREATE OR REPLACE FUNCTION public.fn_guard_integrity_enqueue_upstream()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_upstream_not_ready boolean;
BEGIN
  IF NEW.job_type != 'package_run_integrity_check' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IN ('cancelled', 'failed', 'completed', 'done') THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM package_steps ps
    WHERE ps.package_id = NEW.package_id
      AND ps.step_key IN (
        'validate_exam_pool',
        'validate_blueprints',
        'validate_blueprint_variants',
        'promote_blueprint_variants',
        'repair_exam_pool_quality',
        'validate_oral_exam',
        'validate_lesson_minichecks',
        'validate_handbook',
        'validate_handbook_depth'
      )
      AND ps.status NOT IN ('done', 'skipped')
  ) INTO v_upstream_not_ready;

  IF v_upstream_not_ready THEN
    -- Silently drop the insert - no cancelled row in the queue
    PERFORM public.fn_log_guardrail_event(
      'integrity_enqueue_blocked',
      jsonb_build_object(
        'package_id', NEW.package_id,
        'reason', 'upstream_validation_steps_not_complete',
        'job_type', NEW.job_type
      )
    );
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;
