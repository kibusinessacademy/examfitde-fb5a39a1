
-- FIX: Cascade-Reset Skip-Logic — Guard 4 & Guard 5 korrigiert
-- Problem: Guard 5 skippt auch wenn der Upstream ein GÜLTIGER Invalidator ist.
-- Problem: Guard 4 enthält toten Inner-Loop (redundant mit äußerem @> Check).
-- Fix: Guard 4 vereinfacht, Guard 5 entfernt (nach Guard 4 ist Upstream immer ein Invalidator).

CREATE OR REPLACE FUNCTION cascade_reset_downstream_steps()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  -- DAG definition (SSOT mirror of job-map.ts PIPELINE_GRAPH)
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

  -- Semantic invalidation policy: downstream_step → array of upstream steps that invalidate it.
  -- If trigger step IS in this list → RESET (even if artifacts exist).
  -- If trigger step is NOT in this list → SKIP (artifact protected).
  -- Steps NOT listed here (governance: run_integrity_check, quality_council, auto_publish) → ALWAYS RESET.
  v_invalidation_policy jsonb := '{
    "validate_learning_content": ["generate_learning_content"],
    "auto_seed_exam_blueprints": ["generate_learning_content", "validate_learning_content"],
    "validate_blueprints": ["auto_seed_exam_blueprints"],
    "generate_exam_pool": ["auto_seed_exam_blueprints", "validate_blueprints"],
    "validate_exam_pool": ["generate_exam_pool"],
    "build_ai_tutor_index": ["generate_exam_pool", "validate_exam_pool"],
    "validate_tutor_index": ["build_ai_tutor_index"],
    "generate_oral_exam": ["build_ai_tutor_index", "validate_tutor_index"],
    "validate_oral_exam": ["generate_oral_exam"],
    "generate_lesson_minichecks": ["generate_learning_content", "validate_learning_content"],
    "validate_lesson_minichecks": ["generate_lesson_minichecks"],
    "generate_handbook": ["generate_learning_content", "validate_learning_content"],
    "validate_handbook": ["generate_handbook"],
    "enqueue_handbook_expand": ["generate_handbook", "validate_handbook"],
    "expand_handbook": ["enqueue_handbook_expand"],
    "validate_handbook_depth": ["expand_handbook"],
    "elite_harden": ["generate_exam_pool", "validate_exam_pool"],
    "generate_glossary": ["scaffold_learning_course"]
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
  v_skipped_policy int := 0;
  v_skipped_idempotent int := 0;
  v_key text;
  v_job_type text;
  v_cnt int;
  v_invalidators jsonb;
  v_run_id text;
  v_meta_patch jsonb;
  v_actually_reset text[] := '{}';
  v_trigger_is_invalidator boolean;
BEGIN
  -- GUARD 1: Only fire on transition TO queued
  IF NEW.status != 'queued' THEN RETURN NEW; END IF;
  IF OLD.status NOT IN ('done', 'running', 'enqueued', 'failed') THEN RETURN NEW; END IF;

  -- GUARD 2: Batch/Migration suppress flag
  BEGIN
    IF current_setting('app.suppress_cascade_reset', true) = 'on' THEN
      RAISE LOG 'cascade_reset: SUPPRESSED for step=% pkg=% (app.suppress_cascade_reset=on)', 
        NEW.step_key, NEW.package_id;
      RETURN NEW;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Generate unique run ID for this cascade event
  v_run_id := gen_random_uuid()::text;

  -- BFS: collect all downstream steps in the DAG
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

  -- Build meta patch for audit trail
  v_meta_patch := jsonb_build_object(
    'cascade_reset_at', now()::text,
    'cascade_reset_by_step', NEW.step_key,
    'cascade_reset_from_status', OLD.status,
    'cascade_reset_run_id', v_run_id
  );

  -- Process each downstream step with guards
  FOREACH v_key IN ARRAY v_downstream_keys LOOP

    -- GUARD 3: Idempotency — skip steps already in queued status
    PERFORM 1 FROM package_steps
    WHERE package_id = NEW.package_id
      AND step_key = v_key
      AND status = 'queued';
    IF FOUND THEN
      v_skipped_idempotent := v_skipped_idempotent + 1;
      CONTINUE;
    END IF;

    -- GUARD 4: Semantic invalidation policy
    -- Logic: If a policy exists for this downstream step, check whether
    -- the TRIGGERING step (NEW.step_key) is listed as a valid invalidator.
    -- If NOT listed → skip (the upstream change doesn't semantically affect this branch).
    -- If no policy exists (governance steps) → always reset.
    v_invalidators := v_invalidation_policy -> v_key;
    IF v_invalidators IS NOT NULL THEN
      -- Policy exists. Check if trigger step is a valid invalidator using explicit EXISTS.
      SELECT EXISTS(
        SELECT 1 FROM jsonb_array_elements_text(v_invalidators) AS inv
        WHERE inv.value = NEW.step_key
      ) INTO v_trigger_is_invalidator;

      IF NOT v_trigger_is_invalidator THEN
        -- Trigger step is NOT a valid invalidator for this downstream → SKIP
        v_skipped_policy := v_skipped_policy + 1;
        RAISE LOG 'cascade_reset: SKIP step=% pkg=% (policy: upstream=% not in invalidators=[%])',
          v_key, NEW.package_id, NEW.step_key, v_invalidators::text;
        CONTINUE;
      END IF;
      -- Trigger step IS a valid invalidator → proceed with reset (even if artifacts exist)
    END IF;
    -- No policy (governance steps: run_integrity_check, quality_council, auto_publish) → always reset

    -- Actually reset this step
    UPDATE package_steps
    SET status = 'queued',
        started_at = NULL,
        finished_at = NULL,
        last_error = 'Cascade reset (DAG): upstream ' || NEW.step_key || ' was reset',
        meta = COALESCE(meta, '{}'::jsonb) || v_meta_patch
    WHERE package_id = NEW.package_id
      AND step_key = v_key
      AND status IN ('done', 'running', 'enqueued', 'failed');
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_reset_steps := v_reset_steps + v_cnt;
    IF v_cnt > 0 THEN
      v_actually_reset := array_append(v_actually_reset, v_key);
    END IF;

    -- Cancel pending/processing jobs for this step
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

  -- Structured log with full audit trail
  RAISE LOG 'cascade_reset: run=% trigger_step=% pkg=% from_status=% reset=% cancelled=% skipped_idempotent=% skipped_policy=% reset_steps=%',
    v_run_id, NEW.step_key, NEW.package_id, OLD.status,
    v_reset_steps, v_cancelled_jobs, v_skipped_idempotent, v_skipped_policy,
    array_to_string(v_actually_reset, ',');

  RETURN NEW;
END;
$$;
