
-- Cascade reset: When a step is reset (done/running → queued), 
-- automatically reset all downstream steps AND cancel their pending/processing jobs.
-- This prevents race conditions where stale validator jobs run on outdated data.

CREATE OR REPLACE FUNCTION cascade_reset_downstream_steps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  -- SSOT step order (mirrors FULL_STEP_ORDER from job-map.ts)
  v_step_order text[] := ARRAY[
    'scaffold_learning_course',
    'generate_glossary',
    'generate_learning_content',
    'validate_learning_content',
    'auto_seed_exam_blueprints',
    'validate_blueprints',
    'generate_exam_pool',
    'validate_exam_pool',
    'build_ai_tutor_index',
    'validate_tutor_index',
    'generate_oral_exam',
    'validate_oral_exam',
    'generate_lesson_minichecks',
    'validate_lesson_minichecks',
    'generate_handbook',
    'validate_handbook',
    'enqueue_handbook_expand',
    'expand_handbook',
    'validate_handbook_depth',
    'elite_harden',
    'run_integrity_check',
    'quality_council',
    'auto_publish'
  ];
  v_reset_idx int;
  v_downstream_keys text[];
  v_job_type_map jsonb := '{
    "scaffold_learning_course": "package_scaffold_learning_course",
    "generate_glossary": "package_generate_glossary",
    "generate_learning_content": "package_generate_learning_content",
    "validate_learning_content": "package_validate_learning_content",
    "auto_seed_exam_blueprints": "package_auto_seed_exam_blueprints",
    "validate_blueprints": "package_validate_blueprints",
    "generate_exam_pool": "package_generate_exam_pool",
    "validate_exam_pool": "package_validate_exam_pool",
    "build_ai_tutor_index": "package_build_ai_tutor_index",
    "validate_tutor_index": "package_validate_tutor_index",
    "generate_oral_exam": "package_generate_oral_exam",
    "validate_oral_exam": "package_validate_oral_exam",
    "generate_lesson_minichecks": "package_generate_lesson_minichecks",
    "validate_lesson_minichecks": "package_validate_lesson_minichecks",
    "generate_handbook": "package_generate_handbook",
    "validate_handbook": "package_validate_handbook",
    "enqueue_handbook_expand": "package_enqueue_handbook_expand",
    "expand_handbook": "handbook_expand_section",
    "validate_handbook_depth": "package_validate_handbook_depth",
    "elite_harden": "package_elite_harden",
    "run_integrity_check": "package_run_integrity_check",
    "quality_council": "package_quality_council",
    "auto_publish": "package_auto_publish"
  }'::jsonb;
  v_cancelled_jobs int := 0;
  v_reset_steps int := 0;
  v_key text;
  v_job_type text;
BEGIN
  -- Only trigger on reset: step going FROM done/running/enqueued/failed TO queued
  IF NEW.status != 'queued' THEN RETURN NEW; END IF;
  IF OLD.status NOT IN ('done', 'running', 'enqueued', 'failed') THEN RETURN NEW; END IF;

  -- Find index of reset step
  v_reset_idx := array_position(v_step_order, NEW.step_key);
  IF v_reset_idx IS NULL THEN RETURN NEW; END IF;

  -- Collect all downstream step keys
  v_downstream_keys := v_step_order[(v_reset_idx + 1):];
  IF array_length(v_downstream_keys, 1) IS NULL THEN RETURN NEW; END IF;

  -- Reset downstream steps that are done/running/enqueued/failed
  UPDATE package_steps
  SET status = 'queued',
      attempts = 0,
      last_error = format('Cascade reset: upstream %s was reset', NEW.step_key),
      started_at = NULL,
      finished_at = NULL,
      job_id = NULL
  WHERE package_id = NEW.package_id
    AND step_key = ANY(v_downstream_keys)
    AND status IN ('done', 'running', 'enqueued', 'failed');
  
  GET DIAGNOSTICS v_reset_steps = ROW_COUNT;

  -- Cancel pending/processing jobs for downstream steps
  FOREACH v_key IN ARRAY v_downstream_keys LOOP
    v_job_type := v_job_type_map ->> v_key;
    IF v_job_type IS NOT NULL THEN
      UPDATE job_queue
      SET status = 'cancelled',
          last_error = format('Cascade reset: upstream %s was reset', NEW.step_key)
      WHERE package_id = NEW.package_id
        AND job_type = v_job_type
        AND status IN ('pending', 'processing');
      
      GET DIAGNOSTICS v_cancelled_jobs = ROW_COUNT;
    END IF;
  END LOOP;

  IF v_reset_steps > 0 OR v_cancelled_jobs > 0 THEN
    RAISE LOG 'cascade_reset: step % reset on package % → % downstream steps reset, % jobs cancelled',
      NEW.step_key, NEW.package_id, v_reset_steps, v_cancelled_jobs;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cascade_reset_downstream_steps ON package_steps;
CREATE TRIGGER trg_cascade_reset_downstream_steps
  AFTER UPDATE OF status ON package_steps
  FOR EACH ROW
  EXECUTE FUNCTION cascade_reset_downstream_steps();
