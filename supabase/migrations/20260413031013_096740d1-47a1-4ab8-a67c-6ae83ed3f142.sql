
-- Fix 1: Debounce muss cancelled einschließen
CREATE OR REPLACE FUNCTION public.fn_debounce_integrity_check()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  _recent_count int;
BEGIN
  IF NEW.job_type != 'package_run_integrity_check' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO _recent_count
  FROM job_queue
  WHERE package_id = NEW.package_id
    AND job_type = 'package_run_integrity_check'
    AND created_at > now() - interval '15 minutes'
    AND status IN ('pending', 'processing', 'completed', 'cancelled');

  IF _recent_count > 0 THEN
    RAISE LOG 'DEBOUNCE: Skipping duplicate package_run_integrity_check for package % (% recent)', 
      NEW.package_id, _recent_count;
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- Fix 2: Guard schreibt in last_error statt error für Sichtbarkeit
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
    NEW.status := 'cancelled';
    NEW.last_error := 'GUARD: upstream validation steps not complete';
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
      'guard', 'fn_guard_integrity_enqueue_upstream',
      'cancelled_at', now()::text
    );
  END IF;

  RETURN NEW;
END;
$$;
