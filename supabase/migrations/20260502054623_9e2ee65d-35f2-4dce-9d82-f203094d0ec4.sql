-- ============================================================
-- v4: DAG-aware coupling heal mit Cancel-Cooldown
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_heal_step_job_coupling_v4(
  _step_keys text[] DEFAULT ARRAY[
    'scaffold_learning_course','generate_glossary','fanout_learning_content',
    'generate_learning_content','finalize_learning_content','validate_learning_content',
    'auto_seed_exam_blueprints','validate_blueprints',
    'generate_blueprint_variants','validate_blueprint_variants','promote_blueprint_variants',
    'generate_exam_pool','validate_exam_pool','repair_exam_pool_quality',
    'build_ai_tutor_index','validate_tutor_index',
    'generate_oral_exam','validate_oral_exam',
    'generate_lesson_minichecks','validate_lesson_minichecks',
    'generate_handbook','validate_handbook','enqueue_handbook_expand','expand_handbook','validate_handbook_depth',
    'elite_harden','run_integrity_check','quality_council','auto_publish'
  ]
)
RETURNS TABLE(package_id uuid, step_key text, action text, job_id uuid, err text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
  new_job_id uuid;
  v_predecessors_ok boolean;
  v_cancel_loop_count int;
  v_skip_reason text;

  -- Hardcoded predecessor map (matches DAG, falls dependencies-Tabelle nicht existiert)
  -- step_key → array of required-done predecessor step_keys
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

    -- Guard 1: DAG-Predecessor-Check
    IF v_predmap ? r.step_key_t THEN
      SELECT NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(v_predmap->r.step_key_t) AS pred(key)
        WHERE NOT EXISTS (
          SELECT 1 FROM package_steps ps2
          WHERE ps2.package_id = r.pkg_id
            AND ps2.step_key::text = pred.key
            AND ps2.status IN ('done', 'skipped', 'completed')
        )
      ) INTO v_predecessors_ok;

      IF NOT v_predecessors_ok THEN
        v_skip_reason := 'PREDECESSORS_NOT_DONE';
      END IF;
    END IF;

    -- Guard 2: Cancel-Cooldown (≥3 cancelled jobs in last 1h → skip)
    IF v_skip_reason IS NULL THEN
      SELECT COUNT(*) INTO v_cancel_loop_count
      FROM job_queue jq
      WHERE jq.package_id = r.pkg_id
        AND jq.job_type = 'package_' || r.step_key_t
        AND jq.status = 'cancelled'
        AND jq.created_at > now() - interval '1 hour';

      IF v_cancel_loop_count >= 3 THEN
        v_skip_reason := format('CANCEL_LOOP_COOLDOWN: %s cancelled in last hour', v_cancel_loop_count);
      END IF;
    END IF;

    IF v_skip_reason IS NOT NULL THEN
      -- Audit + emit skip
      INSERT INTO auto_heal_log (action_type, trigger_source, result_status, result_detail, target_type, target_id)
      VALUES ('coupling_heal_v4_skip', 'cron_coupling_heal_15min', 'skipped',
              jsonb_build_object('package_id', r.pkg_id, 'step_key', r.step_key_t, 'reason', v_skip_reason)::text,
              'package_step', r.step_id::text);

      package_id := r.pkg_id; step_key := r.step_key_t;
      action := 'skipped'; job_id := NULL; err := v_skip_reason;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- All guards passed → enqueue
    BEGIN
      INSERT INTO job_queue(job_type, payload, status, max_attempts, priority, package_id, meta)
      VALUES (
        'package_' || r.step_key_t,
        jsonb_build_object('package_id', r.pkg_id, 'curriculum_id', r.curr_id, 'enqueue_source', 'admin_heal_step_job_coupling_v4'),
        'pending', 8, 50, r.pkg_id,
        jsonb_build_object(
          'source','admin_heal_step_job_coupling_v4',
          'reason','dag_aware_coupling_recovery',
          'healed_at', now()
        )
      )
      RETURNING id INTO new_job_id;

      package_id := r.pkg_id; step_key := r.step_key_t;
      action := 're_enqueued'; job_id := new_job_id; err := NULL;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      package_id := r.pkg_id; step_key := r.step_key_t;
      action := 'enqueue_failed'; job_id := NULL; err := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_heal_step_job_coupling_v4(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_heal_step_job_coupling_v4(text[]) TO service_role;

-- Switch cron to v4
DO $$
BEGIN PERFORM cron.unschedule('coupling_heal_15min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'coupling_heal_15min_v4',
  '*/15 * * * *',
  $$SELECT count(*) FROM public.admin_heal_step_job_coupling_v4();$$
);

-- Mark the legacy function as deprecated via comment (do not drop — rollback safety)
COMMENT ON FUNCTION public.admin_heal_step_job_coupling(text[]) IS
'DEPRECATED 2026-05-02: replaced by admin_heal_step_job_coupling_v4 (DAG-aware + cancel-cooldown). Was main producer of UPSTREAM_CAUSALITY cancel-loops (1783 gen_exam_pool + 1003 quality_council cancelled/24h). Do not call.';