
-- 1. STALE_LOCK_EXHAUSTED healer
CREATE OR REPLACE FUNCTION public.fn_auto_heal_stale_lock_exhausted()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_healed int := 0;
  v_step record;
BEGIN
  FOR v_step IN
    SELECT ps.id, ps.package_id, ps.step_key
    FROM package_steps ps
    WHERE ps.status IN ('queued','failed')
      AND ps.last_error ILIKE '%STALE_LOCK_EXHAUSTED%'
      AND ps.updated_at < now() - interval '10 minutes'
  LOOP
    -- Clear any stale locks on the package
    UPDATE course_packages
    SET pipeline_lock = NULL,
        pipeline_locked_at = NULL,
        pipeline_lock_holder = NULL
    WHERE id = v_step.package_id
      AND pipeline_locked_at < now() - interval '15 minutes';

    -- Reset step
    UPDATE package_steps
    SET status = 'queued',
        last_error = 'AUTO_HEALED:stale_lock_cleared_' || now()::text,
        updated_at = now()
    WHERE id = v_step.id;

    -- Cancel any stuck jobs for this step
    UPDATE job_queue
    SET status = 'cancelled',
        completed_at = now(),
        result = jsonb_build_object('reason', 'auto_healed_stale_lock')
    WHERE package_id = v_step.package_id
      AND status IN ('pending','processing')
      AND job_type = (
        SELECT CASE v_step.step_key
          WHEN 'generate_handbook' THEN 'package_generate_handbook'
          WHEN 'generate_learning_content' THEN 'package_generate_learning_content'
          ELSE 'package_' || v_step.step_key
        END
      );

    -- Enqueue fresh job
    INSERT INTO job_queue (package_id, job_type, status, priority, created_at)
    VALUES (
      v_step.package_id,
      CASE v_step.step_key
        WHEN 'generate_handbook' THEN 'package_generate_handbook'
        WHEN 'generate_learning_content' THEN 'package_generate_learning_content'
        ELSE 'package_' || v_step.step_key
      END,
      'pending',
      5,
      now()
    );

    v_healed := v_healed + 1;

    INSERT INTO admin_actions (action, scope, payload, affected_ids, created_at)
    VALUES ('auto_heal_stale_lock', v_step.step_key,
            jsonb_build_object('package_id', v_step.package_id, 'step_key', v_step.step_key),
            ARRAY[v_step.package_id::text], now());
  END LOOP;

  RETURN jsonb_build_object('healed', v_healed, 'type', 'stale_lock_exhausted');
END;
$$;

-- 2. HARD_FAIL_REPAIR_EXHAUSTED healer
CREATE OR REPLACE FUNCTION public.fn_auto_heal_hard_fail_repair_exhausted()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_healed int := 0;
  v_skipped int := 0;
  v_step record;
  v_q_count int;
  v_threshold int;
BEGIN
  FOR v_step IN
    SELECT ps.id, ps.package_id, ps.step_key, cp.title
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status IN ('queued','failed')
      AND ps.last_error ILIKE '%HARD_FAIL_REPAIR_EXHAUSTED%'
      AND ps.step_key = 'validate_exam_pool'
  LOOP
    -- Check if the underlying issue is now resolved: enough approved questions?
    SELECT COUNT(*) INTO v_q_count
    FROM exam_questions eq
    JOIN curricula c ON c.certification_id = eq.certification_id
    JOIN course_packages cp2 ON cp2.curriculum_id = c.id
    WHERE cp2.id = v_step.package_id
      AND eq.qc_status IN ('approved', 'tier1_passed');

    -- Threshold: at least 50 questions to retry validation
    v_threshold := 50;

    IF v_q_count >= v_threshold THEN
      -- Reset step for re-validation
      UPDATE package_steps
      SET status = 'queued',
          last_error = 'AUTO_HEALED:repair_exhausted_reset_q=' || v_q_count || '_at_' || now()::text,
          updated_at = now()
      WHERE id = v_step.id;

      -- Cancel old stuck jobs
      UPDATE job_queue
      SET status = 'cancelled', completed_at = now(),
          result = jsonb_build_object('reason', 'auto_healed_repair_exhausted')
      WHERE package_id = v_step.package_id
        AND job_type = 'package_validate_exam_pool'
        AND status IN ('pending','processing');

      -- Enqueue fresh validation
      INSERT INTO job_queue (package_id, job_type, status, priority, created_at)
      VALUES (v_step.package_id, 'package_validate_exam_pool', 'pending', 5, now());

      v_healed := v_healed + 1;

      INSERT INTO admin_actions (action, scope, payload, affected_ids, created_at)
      VALUES ('auto_heal_repair_exhausted', v_step.step_key,
              jsonb_build_object('package_id', v_step.package_id, 'q_count', v_q_count, 'threshold', v_threshold),
              ARRAY[v_step.package_id::text], now());
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('healed', v_healed, 'skipped_below_threshold', v_skipped, 'type', 'hard_fail_repair_exhausted');
END;
$$;

-- 3. MATERIALIZATION_GUARD healer
CREATE OR REPLACE FUNCTION public.fn_auto_heal_materialization_guard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_healed int := 0;
  v_skipped int := 0;
  v_step record;
  v_artifact_count int;
BEGIN
  FOR v_step IN
    SELECT ps.id, ps.package_id, ps.step_key, cp.curriculum_id
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status IN ('queued','failed')
      AND ps.last_error ILIKE '%MATERIALIZATION_GUARD%'
  LOOP
    IF v_step.step_key = 'generate_lesson_minichecks' THEN
      -- Check if lessons with actual content now exist
      SELECT COUNT(*) INTO v_artifact_count
      FROM lessons l
      WHERE l.curriculum_id = v_step.curriculum_id
        AND l.content IS NOT NULL
        AND length(l.content::text) > 100;

      IF v_artifact_count >= 5 THEN
        UPDATE package_steps
        SET status = 'queued',
            last_error = 'AUTO_HEALED:materialization_ok_artifacts=' || v_artifact_count || '_at_' || now()::text,
            updated_at = now()
        WHERE id = v_step.id;

        UPDATE job_queue
        SET status = 'cancelled', completed_at = now(),
            result = jsonb_build_object('reason', 'auto_healed_materialization')
        WHERE package_id = v_step.package_id
          AND job_type = 'package_generate_lesson_minichecks'
          AND status IN ('pending','processing');

        INSERT INTO job_queue (package_id, job_type, status, priority, created_at)
        VALUES (v_step.package_id, 'package_generate_lesson_minichecks', 'pending', 5, now());

        v_healed := v_healed + 1;

        INSERT INTO admin_actions (action, scope, payload, affected_ids, created_at)
        VALUES ('auto_heal_materialization', v_step.step_key,
                jsonb_build_object('package_id', v_step.package_id, 'artifact_count', v_artifact_count),
                ARRAY[v_step.package_id::text], now());
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('healed', v_healed, 'skipped_no_artifacts', v_skipped, 'type', 'materialization_guard');
END;
$$;

-- 4. Master healer
CREATE OR REPLACE FUNCTION public.fn_heal_upstream_hotspots()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stale jsonb;
  v_repair jsonb;
  v_mat jsonb;
BEGIN
  v_stale := fn_auto_heal_stale_lock_exhausted();
  v_repair := fn_auto_heal_hard_fail_repair_exhausted();
  v_mat := fn_auto_heal_materialization_guard();

  RETURN jsonb_build_object(
    'stale_lock', v_stale,
    'repair_exhausted', v_repair,
    'materialization', v_mat,
    'healed_at', now()
  );
END;
$$;
