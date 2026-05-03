
CREATE OR REPLACE FUNCTION public.admin_heal_step_job_coupling_v4(_step_keys text[] DEFAULT ARRAY['scaffold_learning_course'::text, 'generate_glossary'::text, 'fanout_learning_content'::text, 'generate_learning_content'::text, 'finalize_learning_content'::text, 'validate_learning_content'::text, 'auto_seed_exam_blueprints'::text, 'validate_blueprints'::text, 'generate_blueprint_variants'::text, 'validate_blueprint_variants'::text, 'promote_blueprint_variants'::text, 'generate_exam_pool'::text, 'validate_exam_pool'::text, 'repair_exam_pool_quality'::text, 'build_ai_tutor_index'::text, 'validate_tutor_index'::text, 'generate_oral_exam'::text, 'validate_oral_exam'::text, 'generate_lesson_minichecks'::text, 'validate_lesson_minichecks'::text, 'generate_handbook'::text, 'validate_handbook'::text, 'enqueue_handbook_expand'::text, 'expand_handbook'::text, 'validate_handbook_depth'::text, 'elite_harden'::text, 'run_integrity_check'::text, 'quality_council'::text, 'auto_publish'::text])
 RETURNS TABLE(package_id uuid, step_key text, action text, job_id uuid, err text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  new_job_id uuid;
  v_predecessors_ok boolean;
  v_cancel_loop_count int;
  v_skip_reason text;
  v_predmap jsonb := jsonb_build_object(
    'auto_seed_exam_blueprints', jsonb_build_array('scaffold_learning_course'),
    'validate_blueprints', jsonb_build_array('auto_seed_exam_blueprints'),
    'generate_blueprint_variants', jsonb_build_array('validate_blueprints'),
    'validate_blueprint_variants', jsonb_build_array('generate_blueprint_variants'),
    'promote_blueprint_variants', jsonb_build_array('validate_blueprint_variants'),
    'generate_exam_pool', jsonb_build_array('validate_blueprints'),
    'validate_exam_pool', jsonb_build_array('generate_exam_pool'),
    'repair_exam_pool_quality', jsonb_build_array('validate_exam_pool'),
    'build_ai_tutor_index', jsonb_build_array('finalize_learning_content'),
    'validate_tutor_index', jsonb_build_array('build_ai_tutor_index'),
    'generate_oral_exam', jsonb_build_array('validate_exam_pool'),
    'validate_oral_exam', jsonb_build_array('generate_oral_exam'),
    'generate_lesson_minichecks', jsonb_build_array('finalize_learning_content'),
    'validate_lesson_minichecks', jsonb_build_array('generate_lesson_minichecks'),
    'generate_handbook', jsonb_build_array('finalize_learning_content'),
    'validate_handbook', jsonb_build_array('generate_handbook'),
    'enqueue_handbook_expand', jsonb_build_array('validate_handbook'),
    'expand_handbook', jsonb_build_array('enqueue_handbook_expand'),
    'validate_handbook_depth', jsonb_build_array('expand_handbook'),
    'elite_harden', jsonb_build_array('validate_exam_pool'),
    'run_integrity_check', jsonb_build_array('elite_harden'),
    'quality_council', jsonb_build_array('run_integrity_check'),
    'auto_publish', jsonb_build_array('quality_council')
  );
BEGIN
  FOR r IN
    SELECT DISTINCT
      ps.package_id AS pkg_id,
      ps.step_key::text AS step_key_t,
      cp.curriculum_id AS curr_id,
      ps.id AS step_id
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'queued'
      AND ps.step_key::text = ANY(_step_keys)
      AND cp.status = 'building'
      AND cp.curriculum_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = ps.package_id
          AND jq.job_type = 'package_' || ps.step_key::text
          AND jq.status IN ('pending','queued','processing','running','batch_pending')
      )
  LOOP
    v_skip_reason := NULL;
    v_predecessors_ok := TRUE;

    IF v_predmap ? r.step_key_t THEN
      SELECT NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(v_predmap->r.step_key_t) AS pred(key)
        WHERE NOT EXISTS (
          SELECT 1 FROM package_steps ps2
          WHERE ps2.package_id = r.pkg_id
            AND ps2.step_key::text = pred.key
            AND ps2.status IN ('done', 'skipped')
        )
      ) INTO v_predecessors_ok;

      IF NOT v_predecessors_ok THEN
        v_skip_reason := 'PREDECESSORS_NOT_DONE';
      END IF;
    END IF;

    IF v_skip_reason IS NULL THEN
      SELECT COUNT(*) INTO v_cancel_loop_count
      FROM job_queue jq
      WHERE jq.package_id = r.pkg_id
        AND jq.job_type = 'package_' || r.step_key_t
        AND jq.status = 'cancelled'
        AND jq.updated_at > now() - interval '1 hour';
      IF v_cancel_loop_count >= 3 THEN
        v_skip_reason := 'CANCEL_COOLDOWN';
      END IF;
    END IF;

    IF v_skip_reason IS NULL AND r.step_key_t = 'repair_exam_pool_quality' THEN
      IF EXISTS (
        SELECT 1 FROM package_steps ps3
        WHERE ps3.package_id = r.pkg_id
          AND ps3.step_key::text = 'generate_exam_pool'
          AND ps3.status IN ('done','skipped')
      ) THEN
        v_skip_reason := 'PHANTOM_REPAIR_TARGET_DONE';
      END IF;
    END IF;

    IF v_skip_reason IS NOT NULL THEN
      package_id := r.pkg_id; step_key := r.step_key_t;
      action := 'skipped'; job_id := NULL; err := v_skip_reason;
      RETURN NEXT;
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO job_queue(job_type, package_id, payload, status, priority, worker_pool)
      VALUES (
        'package_' || r.step_key_t,
        r.pkg_id,
        jsonb_build_object('package_id', r.pkg_id, 'curriculum_id', r.curr_id, 'step_key', r.step_key_t),
        'pending',
        100,
        COALESCE((SELECT jtp.worker_pool FROM job_type_policies jtp WHERE jtp.job_type = 'package_' || r.step_key_t), 'default')
      )
      RETURNING id INTO new_job_id;

      package_id := r.pkg_id; step_key := r.step_key_t;
      action := 'enqueued'; job_id := new_job_id; err := NULL;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      package_id := r.pkg_id; step_key := r.step_key_t;
      action := 'enqueue_failed'; job_id := NULL; err := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$function$;
