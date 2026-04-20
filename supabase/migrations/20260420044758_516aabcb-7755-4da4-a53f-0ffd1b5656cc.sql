
-- ════════════════════════════════════════════════════════════════════
-- WAVE 13/14: Klassen-spezifische Restpaket-Heilung
-- ════════════════════════════════════════════════════════════════════
-- Klasse D (State-Drift): Varianten existieren, Promote nicht adoptiert
-- Klasse B (No Variants): Blueprints da, Varianten fehlen
-- Klasse A (No Source): Curriculum praktisch leer → Source-Repair
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_heal_remaining_packages_by_class()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg RECORD;
  v_promote_result jsonb;
  v_generate_result jsonb;
  v_seed_result jsonb;
  v_class_d_healed int := 0;
  v_class_d_failed int := 0;
  v_class_b_triggered int := 0;
  v_class_a_triggered int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_details jsonb := '[]'::jsonb;
BEGIN
  -- ─── Klasse D: Promote-Adoption für Pakete mit eligible Varianten ───
  FOR v_pkg IN
    SELECT cp.id AS package_id, cp.curriculum_id, cp.title
    FROM course_packages cp
    WHERE cp.status NOT IN ('archived','draft','retired')
      AND NOT EXISTS (SELECT 1 FROM exam_questions eq WHERE eq.curriculum_id = cp.curriculum_id)
      AND EXISTS (
        SELECT 1 FROM exam_question_variants eqv
        WHERE eqv.curriculum_id = cp.curriculum_id
          AND eqv.status IN ('review','approved')
      )
  LOOP
    BEGIN
      v_promote_result := fn_prebuild_promote_blueprint_variants(v_pkg.package_id);
      IF (v_promote_result->>'ok')::boolean = true THEN
        v_class_d_healed := v_class_d_healed + 1;
        v_details := v_details || jsonb_build_object(
          'class','D','package_id',v_pkg.package_id,'title',v_pkg.title,
          'result',v_promote_result
        );
      ELSE
        v_class_d_failed := v_class_d_failed + 1;
        v_errors := v_errors || jsonb_build_object(
          'class','D','package_id',v_pkg.package_id,'title',v_pkg.title,
          'reason',v_promote_result
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_class_d_failed := v_class_d_failed + 1;
      v_errors := v_errors || jsonb_build_object(
        'class','D','package_id',v_pkg.package_id,'title',v_pkg.title,
        'error',SQLERRM
      );
    END;
  END LOOP;

  -- ─── Klasse B: Variants fehlen → Job enqueuen ───
  FOR v_pkg IN
    SELECT cp.id AS package_id, cp.curriculum_id, cp.title
    FROM course_packages cp
    WHERE cp.status NOT IN ('archived','draft','retired')
      AND NOT EXISTS (SELECT 1 FROM exam_questions eq WHERE eq.curriculum_id = cp.curriculum_id)
      AND NOT EXISTS (SELECT 1 FROM exam_question_variants eqv WHERE eqv.curriculum_id = cp.curriculum_id)
      AND (SELECT COUNT(*) FROM question_blueprints qb WHERE qb.curriculum_id = cp.curriculum_id AND qb.status='approved') >= 10
  LOOP
    BEGIN
      -- Step auf queued setzen damit Worker es aufnimmt
      UPDATE package_steps ps
      SET status = 'queued',
          started_at = NULL,
          finished_at = NULL,
          meta = COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
            'requeued_by','wave13_class_b','requeued_at', now()
          )
      WHERE ps.package_id = v_pkg.package_id
        AND ps.step_key = 'generate_blueprint_variants'
        AND ps.status NOT IN ('done');

      v_class_b_triggered := v_class_b_triggered + 1;
      v_details := v_details || jsonb_build_object(
        'class','B','package_id',v_pkg.package_id,'title',v_pkg.title,
        'action','requeued_generate_blueprint_variants'
      );
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'class','B','package_id',v_pkg.package_id,'error',SQLERRM
      );
    END;
  END LOOP;

  -- ─── Klasse A: Null-Source → Seed neu anstoßen ───
  FOR v_pkg IN
    SELECT cp.id AS package_id, cp.curriculum_id, cp.title
    FROM course_packages cp
    WHERE cp.status NOT IN ('archived','draft','retired')
      AND NOT EXISTS (SELECT 1 FROM exam_questions eq WHERE eq.curriculum_id = cp.curriculum_id)
      AND NOT EXISTS (SELECT 1 FROM exam_question_variants eqv WHERE eqv.curriculum_id = cp.curriculum_id)
      AND (SELECT COUNT(*) FROM question_blueprints qb WHERE qb.curriculum_id = cp.curriculum_id AND qb.status='approved') = 0
  LOOP
    BEGIN
      -- Seed-Step auf queued setzen
      UPDATE package_steps ps
      SET status = 'queued',
          started_at = NULL,
          finished_at = NULL,
          meta = COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
            'requeued_by','wave13_class_a','requeued_at', now(),
            'reason','source_gap_no_blueprints'
          )
      WHERE ps.package_id = v_pkg.package_id
        AND ps.step_key IN ('auto_seed_exam_blueprints','generate_exam_pool')
        AND ps.status NOT IN ('done','running');

      v_class_a_triggered := v_class_a_triggered + 1;
      v_details := v_details || jsonb_build_object(
        'class','A','package_id',v_pkg.package_id,'title',v_pkg.title,
        'action','requeued_seed_and_pool'
      );
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'class','A','package_id',v_pkg.package_id,'error',SQLERRM
      );
    END;
  END LOOP;

  -- Audit log
  INSERT INTO admin_actions (action, scope, payload)
  VALUES (
    'wave13_class_specific_heal',
    'system',
    jsonb_build_object(
      'class_d_healed', v_class_d_healed,
      'class_d_failed', v_class_d_failed,
      'class_b_triggered', v_class_b_triggered,
      'class_a_triggered', v_class_a_triggered,
      'error_count', jsonb_array_length(v_errors),
      'errors', v_errors,
      'details', v_details,
      'executed_at', now()
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'class_d_healed', v_class_d_healed,
    'class_d_failed', v_class_d_failed,
    'class_b_triggered', v_class_b_triggered,
    'class_a_triggered', v_class_a_triggered,
    'errors', v_errors
  );
END;
$$;
