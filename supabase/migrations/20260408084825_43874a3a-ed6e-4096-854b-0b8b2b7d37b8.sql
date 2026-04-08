
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
      -- Count lessons with content via competencies linked to the curriculum
      SELECT COUNT(*) INTO v_artifact_count
      FROM lessons l
      JOIN competencies comp ON comp.id = l.competency_id
      JOIN learning_fields lf ON lf.id = comp.learning_field_id
      WHERE lf.curriculum_id = v_step.curriculum_id
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
