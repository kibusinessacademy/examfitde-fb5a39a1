-- B3-FIX: Schemafeste Hollow-Guard-Berechnung
-- Ersetze fragilen modules/curriculum JOIN durch sauberen Pfad:
-- lessons → competencies → learning_fields → curriculum_id (course_packages.curriculum_id)
-- Entferne jsonb_typeof='object' Check (fragil bei text/jsonb-Mix)

CREATE OR REPLACE FUNCTION public.fn_trigger_sync_step_on_job_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_step_key text;
  v_step_map jsonb := '{
    "package_generate_learning_content": "generate_learning_content",
    "package_fanout_learning_content": "fanout_learning_content",
    "package_finalize_learning_content": "finalize_learning_content",
    "package_validate_learning_content": "validate_learning_content",
    "package_generate_exam_pool": "generate_exam_pool",
    "package_validate_exam_pool": "validate_exam_pool",
    "package_generate_handbook": "generate_handbook",
    "package_validate_handbook": "validate_handbook",
    "package_generate_oral_exam": "generate_oral_exam",
    "package_validate_oral_exam": "validate_oral_exam",
    "package_generate_glossary": "generate_glossary",
    "package_generate_lesson_minichecks": "generate_lesson_minichecks",
    "package_validate_lesson_minichecks": "validate_lesson_minichecks",
    "package_validate_tutor_index": "validate_tutor_index",
    "package_validate_blueprints": "validate_blueprints",
    "package_run_integrity_check": "run_integrity_check"
  }'::jsonb;
  v_total_lessons int := 0;
  v_real_lessons int := 0;
  v_placeholder_lessons int := 0;
  v_substantive_ratio numeric := 0;
  v_is_hollow boolean := false;
  v_lc_steps text[] := ARRAY['generate_learning_content','fanout_learning_content','finalize_learning_content','validate_learning_content'];
BEGIN
  IF NEW.status NOT IN ('completed','done') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;
  v_step_key := v_step_map->>NEW.job_type;
  IF v_step_key IS NULL OR NEW.package_id IS NULL THEN RETURN NEW; END IF;

  IF v_step_key = ANY(v_lc_steps) THEN
    -- SCHEMAFESTE Aggregation: lessons → competencies → learning_fields → curriculum_id
    -- KEIN modules, KEIN curriculum, KEIN jsonb_typeof
    SELECT
      COUNT(*),
      COUNT(*) FILTER (
        WHERE COALESCE(length(l.content::text), 0) >= 1000
          AND COALESCE(l.generation_status, 'pending') NOT IN ('pending','placeholder','failed')
      ),
      COUNT(*) FILTER (
        WHERE l.content IS NULL
          OR COALESCE(length(l.content::text), 0) < 200
          OR COALESCE(l.generation_status, 'pending') IN ('pending','placeholder')
      )
    INTO v_total_lessons, v_real_lessons, v_placeholder_lessons
    FROM course_packages cp
    JOIN learning_fields lf ON lf.curriculum_id = cp.curriculum_id
    JOIN competencies co ON co.learning_field_id = lf.id
    JOIN lessons l ON l.competency_id = co.id
    WHERE cp.id = NEW.package_id;

    IF v_total_lessons > 0 THEN
      v_substantive_ratio := v_real_lessons::numeric / v_total_lessons::numeric;
      v_is_hollow := (v_placeholder_lessons > 0) OR (v_substantive_ratio < 0.90);
    END IF;

    IF v_is_hollow AND v_total_lessons > 0 THEN
      UPDATE package_steps ps
      SET status = 'queued'::step_status,
          last_error = format('B3 Hollow-Guard: %s/%s real, %s placeholders, ratio=%.2f',
                              v_real_lessons, v_total_lessons, v_placeholder_lessons, v_substantive_ratio),
          meta = COALESCE(ps.meta,'{}'::jsonb) || jsonb_build_object(
            'allow_regression', true,
            'allow_regression_by', 'b3_hollow_guard_revoke',
            'hollow_total', v_total_lessons,
            'hollow_real', v_real_lessons,
            'hollow_placeholders', v_placeholder_lessons,
            'hollow_ratio', v_substantive_ratio,
            'hollow_detected_at', now()
          ),
          updated_at = now()
      WHERE ps.package_id = NEW.package_id
        AND ps.step_key = v_step_key
        AND ps.status::text IN ('queued','failed','enqueued','running','done','skipped','pending_enqueue');

      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id, result_status, result_detail, metadata)
      VALUES ('b3_hollow_revoke','fn_trigger_sync_step_on_job_complete','package_step',NEW.package_id::text,'reverted',
              format('Step %s reverted to queued (hollow: %s/%s real)', v_step_key, v_real_lessons, v_total_lessons),
              jsonb_build_object('job_id',NEW.id,'job_type',NEW.job_type,'step_key',v_step_key,'total',v_total_lessons,'real',v_real_lessons,'placeholders',v_placeholder_lessons,'ratio',v_substantive_ratio,'join_path','lessons->competencies->learning_fields->curriculum_id'));
      RETURN NEW;
    END IF;
  END IF;

  UPDATE package_steps
  SET status = 'done'::step_status, updated_at = now()
  WHERE package_id = NEW.package_id AND step_key = v_step_key
    AND status::text IN ('queued','enqueued','running','pending_enqueue');
  RETURN NEW;
END;
$function$;