
CREATE OR REPLACE FUNCTION public.fn_auto_heal_stale_lock_exhausted()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_healed int := 0;
  v_step record;
  v_job_type text;
  v_curriculum_id uuid;
BEGIN
  FOR v_step IN
    SELECT ps.id, ps.package_id, ps.step_key
    FROM package_steps ps
    WHERE ps.status IN ('queued','failed')
      AND ps.last_error ILIKE '%STALE_LOCK_EXHAUSTED%'
      AND ps.updated_at < now() - interval '10 minutes'
  LOOP
    v_job_type := 'package_' || v_step.step_key;

    SELECT cp.curriculum_id INTO v_curriculum_id
    FROM course_packages cp WHERE cp.id = v_step.package_id;

    UPDATE course_packages
    SET pipeline_lock = NULL, pipeline_locked_at = NULL, pipeline_lock_holder = NULL
    WHERE id = v_step.package_id AND pipeline_locked_at < now() - interval '15 minutes';

    UPDATE package_steps
    SET status = 'queued',
        last_error = 'AUTO_HEALED:stale_lock_cleared_' || now()::text,
        updated_at = now()
    WHERE id = v_step.id;

    UPDATE job_queue
    SET status = 'cancelled', completed_at = now(),
        result = jsonb_build_object('reason', 'auto_healed_stale_lock')
    WHERE package_id = v_step.package_id AND job_type = v_job_type AND status IN ('pending','processing');

    INSERT INTO job_queue (package_id, job_type, status, priority, payload, created_at)
    VALUES (v_step.package_id, v_job_type, 'pending', 5,
            jsonb_build_object('source', 'auto_heal_stale_lock', 'curriculum_id', v_curriculum_id),
            now());

    v_healed := v_healed + 1;

    INSERT INTO admin_actions (action, scope, payload, affected_ids, created_at)
    VALUES ('auto_heal_stale_lock', v_step.step_key,
            jsonb_build_object('package_id', v_step.package_id),
            ARRAY[v_step.package_id::text], now());
  END LOOP;

  RETURN jsonb_build_object('healed', v_healed, 'type', 'stale_lock_exhausted');
END;
$$;

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
  v_curriculum_id uuid;
BEGIN
  FOR v_step IN
    SELECT ps.id, ps.package_id, ps.step_key
    FROM package_steps ps
    WHERE ps.status IN ('queued','failed')
      AND ps.last_error ILIKE '%HARD_FAIL_REPAIR_EXHAUSTED%'
      AND ps.step_key = 'validate_exam_pool'
  LOOP
    SELECT cp.curriculum_id INTO v_curriculum_id
    FROM course_packages cp WHERE cp.id = v_step.package_id;

    SELECT COUNT(*) INTO v_q_count
    FROM exam_questions eq
    JOIN curricula c ON c.certification_id = eq.certification_id
    JOIN course_packages cp2 ON cp2.curriculum_id = c.id
    WHERE cp2.id = v_step.package_id
      AND eq.qc_status IN ('approved', 'tier1_passed');

    IF v_q_count >= 50 THEN
      UPDATE package_steps
      SET status = 'queued',
          last_error = 'AUTO_HEALED:repair_exhausted_reset_q=' || v_q_count,
          updated_at = now()
      WHERE id = v_step.id;

      UPDATE job_queue
      SET status = 'cancelled', completed_at = now(),
          result = jsonb_build_object('reason', 'auto_healed_repair_exhausted')
      WHERE package_id = v_step.package_id AND job_type = 'package_validate_exam_pool' AND status IN ('pending','processing');

      INSERT INTO job_queue (package_id, job_type, status, priority, payload, created_at)
      VALUES (v_step.package_id, 'package_validate_exam_pool', 'pending', 5,
              jsonb_build_object('source', 'auto_heal_repair_exhausted', 'q_count', v_q_count, 'curriculum_id', v_curriculum_id),
              now());

      v_healed := v_healed + 1;

      INSERT INTO admin_actions (action, scope, payload, affected_ids, created_at)
      VALUES ('auto_heal_repair_exhausted', 'validate_exam_pool',
              jsonb_build_object('package_id', v_step.package_id, 'q_count', v_q_count),
              ARRAY[v_step.package_id::text], now());
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('healed', v_healed, 'skipped', v_skipped, 'type', 'hard_fail_repair_exhausted');
END;
$$;

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
      SELECT COUNT(*) INTO v_artifact_count
      FROM lessons l
      WHERE l.curriculum_id = v_step.curriculum_id
        AND l.content IS NOT NULL AND length(l.content::text) > 100;

      IF v_artifact_count >= 5 THEN
        UPDATE package_steps
        SET status = 'queued',
            last_error = 'AUTO_HEALED:materialization_ok=' || v_artifact_count,
            updated_at = now()
        WHERE id = v_step.id;

        UPDATE job_queue
        SET status = 'cancelled', completed_at = now(),
            result = jsonb_build_object('reason', 'auto_healed_materialization')
        WHERE package_id = v_step.package_id AND job_type = 'package_generate_lesson_minichecks' AND status IN ('pending','processing');

        INSERT INTO job_queue (package_id, job_type, status, priority, payload, created_at)
        VALUES (v_step.package_id, 'package_generate_lesson_minichecks', 'pending', 5,
                jsonb_build_object('source', 'auto_heal_materialization', 'artifacts', v_artifact_count, 'curriculum_id', v_step.curriculum_id),
                now());

        v_healed := v_healed + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('healed', v_healed, 'skipped', v_skipped, 'type', 'materialization_guard');
END;
$$;
