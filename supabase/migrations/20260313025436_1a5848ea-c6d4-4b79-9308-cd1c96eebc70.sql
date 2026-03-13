
-- FIX: Cascade trigger DAG drift — replace linear array slicing with BFS DAG traversal
-- Root cause: Linear v_step_order[(idx+1):] resets ALL subsequent steps regardless of branch.
-- Example: resetting validate_exam_pool incorrectly resets minichecks+handbook (independent branches).

CREATE OR REPLACE FUNCTION cascade_reset_downstream_steps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  -- SSOT DAG: step_key → direct dependencies (mirrors PIPELINE_GRAPH from job-map.ts)
  v_dag jsonb := '{
    "scaffold_learning_course": [],
    "generate_glossary": ["scaffold_learning_course"],
    "generate_learning_content": ["scaffold_learning_course"],
    "validate_learning_content": ["generate_learning_content"],
    "auto_seed_exam_blueprints": ["validate_learning_content"],
    "validate_blueprints": ["auto_seed_exam_blueprints"],
    "generate_exam_pool": ["validate_blueprints"],
    "validate_exam_pool": ["generate_exam_pool"],
    "build_ai_tutor_index": ["validate_exam_pool"],
    "validate_tutor_index": ["build_ai_tutor_index"],
    "generate_oral_exam": ["validate_exam_pool"],
    "validate_oral_exam": ["generate_oral_exam"],
    "generate_lesson_minichecks": ["validate_learning_content"],
    "validate_lesson_minichecks": ["generate_lesson_minichecks"],
    "generate_handbook": ["validate_learning_content"],
    "validate_handbook": ["generate_handbook"],
    "enqueue_handbook_expand": ["validate_handbook"],
    "expand_handbook": ["enqueue_handbook_expand"],
    "validate_handbook_depth": ["expand_handbook"],
    "elite_harden": ["validate_exam_pool"],
    "run_integrity_check": ["elite_harden","validate_lesson_minichecks","validate_handbook_depth","validate_oral_exam","validate_tutor_index"],
    "quality_council": ["run_integrity_check"],
    "auto_publish": ["quality_council"]
  }'::jsonb;

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

  v_downstream_keys text[] := '{}';
  v_queue text[] := ARRAY[NEW.step_key];
  v_visited text[] := ARRAY[NEW.step_key];
  v_current text;
  v_child text;
  v_deps jsonb;
  v_dep text;
  v_is_downstream boolean;
  v_cancelled_jobs int := 0;
  v_reset_steps int := 0;
  v_key text;
  v_job_type text;
BEGIN
  -- Only trigger on reset: step going FROM done/running/enqueued/failed TO queued
  IF NEW.status != 'queued' THEN RETURN NEW; END IF;
  IF OLD.status NOT IN ('done', 'running', 'enqueued', 'failed') THEN RETURN NEW; END IF;

  -- BFS: find all transitive downstream steps (steps that depend on the reset step)
  WHILE array_length(v_queue, 1) > 0 LOOP
    v_current := v_queue[1];
    v_queue := v_queue[2:];

    -- For each step in the DAG, check if it depends on v_current
    FOR v_child IN SELECT jsonb_object_keys(v_dag) LOOP
      -- Skip already visited
      IF v_child = ANY(v_visited) THEN CONTINUE; END IF;

      v_deps := v_dag -> v_child;
      v_is_downstream := false;

      -- Check if v_current is in this step's dependencies
      FOR v_dep IN SELECT jsonb_array_elements_text(v_deps) LOOP
        IF v_dep = v_current THEN
          v_is_downstream := true;
          EXIT;
        END IF;
      END LOOP;

      IF v_is_downstream THEN
        v_downstream_keys := array_append(v_downstream_keys, v_child);
        v_queue := array_append(v_queue, v_child);
        v_visited := array_append(v_visited, v_child);
      END IF;
    END LOOP;
  END LOOP;

  -- Nothing downstream? Done.
  IF array_length(v_downstream_keys, 1) IS NULL THEN RETURN NEW; END IF;

  -- Reset downstream steps that are done/running/enqueued/failed
  UPDATE package_steps
  SET status = 'queued',
      attempts = 0,
      last_error = format('Cascade reset (DAG): upstream %s was reset', NEW.step_key),
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
          last_error = format('Cascade reset (DAG): upstream %s was reset', NEW.step_key)
      WHERE package_id = NEW.package_id
        AND job_type = v_job_type
        AND status IN ('pending', 'processing');
      
      GET DIAGNOSTICS v_cancelled_jobs = ROW_COUNT;
    END IF;
  END LOOP;

  IF v_reset_steps > 0 OR v_cancelled_jobs > 0 THEN
    RAISE LOG 'cascade_reset_dag: step % reset on package % → % downstream steps reset, % jobs cancelled (keys: %)',
      NEW.step_key, NEW.package_id, v_reset_steps, v_cancelled_jobs, array_to_string(v_downstream_keys, ',');
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cascade_reset_downstream_steps ON package_steps;
CREATE TRIGGER trg_cascade_reset_downstream_steps
  AFTER UPDATE OF status ON package_steps
  FOR EACH ROW
  EXECUTE FUNCTION cascade_reset_downstream_steps();
