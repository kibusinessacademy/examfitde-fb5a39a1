-- FIX: generate_oral_exam DAG dependency: validate_exam_pool → validate_tutor_index

CREATE OR REPLACE FUNCTION cascade_reset_downstream_steps()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
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
    "generate_oral_exam": ["validate_tutor_index"],
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
  v_cnt int;
BEGIN
  IF NEW.status != 'queued' THEN RETURN NEW; END IF;
  IF OLD.status NOT IN ('done', 'running', 'enqueued', 'failed') THEN RETURN NEW; END IF;

  WHILE array_length(v_queue, 1) > 0 LOOP
    v_current := v_queue[1];
    v_queue := v_queue[2:];
    FOR v_child IN SELECT jsonb_object_keys(v_dag) LOOP
      IF v_child = ANY(v_visited) THEN CONTINUE; END IF;
      v_deps := v_dag -> v_child;
      v_is_downstream := false;
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

  IF array_length(v_downstream_keys, 1) IS NULL THEN RETURN NEW; END IF;

  UPDATE package_steps
  SET status = 'queued',
      started_at = NULL,
      finished_at = NULL,
      last_error = 'Cascade reset (DAG): upstream ' || NEW.step_key || ' was reset'
  WHERE package_id = NEW.package_id
    AND step_key = ANY(v_downstream_keys)
    AND status IN ('done', 'running', 'enqueued', 'failed');
  GET DIAGNOSTICS v_reset_steps = ROW_COUNT;

  FOREACH v_key IN ARRAY v_downstream_keys LOOP
    v_job_type := v_job_type_map ->> v_key;
    IF v_job_type IS NOT NULL THEN
      UPDATE job_queue
      SET status = 'cancelled',
          last_error = 'Cascade cancel (DAG): upstream ' || NEW.step_key || ' was reset'
      WHERE payload->>'package_id' = NEW.package_id::text
        AND job_type = v_job_type
        AND status IN ('pending', 'processing', 'queued');
      GET DIAGNOSTICS v_cnt = ROW_COUNT;
      v_cancelled_jobs := v_cancelled_jobs + v_cnt;
    END IF;
  END LOOP;

  RAISE LOG 'cascade_reset: step=% pkg=% reset=% cancelled=%', NEW.step_key, NEW.package_id, v_reset_steps, v_cancelled_jobs;
  RETURN NEW;
END;
$$;

-- Requeue failed oral_exam steps
UPDATE package_steps
SET status = 'queued', started_at = NULL, finished_at = NULL,
    last_error = 'Requeued: DAG fix (oral_exam now depends on validate_tutor_index)'
WHERE step_key = 'generate_oral_exam'
  AND status IN ('queued', 'failed')
  AND package_id IN ('9c1b3734-bb25-4986-baef-5bb1c20a212c'::uuid, '2e8da39f-60f8-44d9-8b70-e1176222ca55'::uuid);

-- Cancel failed jobs
UPDATE job_queue
SET status = 'cancelled', last_error = 'DAG fix: oral_exam dependency corrected to validate_tutor_index'
WHERE job_type = 'package_generate_oral_exam'
  AND status = 'failed';