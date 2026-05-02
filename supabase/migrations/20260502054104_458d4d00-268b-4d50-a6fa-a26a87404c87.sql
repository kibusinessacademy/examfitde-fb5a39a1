-- PHASE 1: Manual Heal
UPDATE package_steps ps
SET status = 'skipped',
    finished_at = COALESCE(ps.finished_at, now()),
    last_error = 'AUTO_SKIP_X3: approved_pool_saturated (≥500 approved questions, mid-pipeline drift heal)',
    updated_at = now()
WHERE ps.package_id IN (
  'b960658d-95e9-4824-a404-821d5e9b5142'::uuid,
  'eff99cc4-785d-4f61-a3ef-12932d8043c3'::uuid,
  'fec61780-be73-4aca-a88e-1c6f1f39d412'::uuid,
  '047bc325-5244-4f21-affd-5395bf62bcff'::uuid,
  '335decc8-9f68-4784-b318-a68f620bf77e'::uuid,
  '570ccb3e-2937-4d81-b3d8-624b9be84737'::uuid
)
  AND ps.status IN ('queued', 'pending_enqueue', 'blocked')
  AND ps.step_key IN (
    'auto_seed_exam_blueprints', 'validate_blueprints',
    'generate_exam_pool', 'validate_exam_pool',
    'repair_exam_pool_quality',
    'generate_blueprint_variants', 'validate_blueprint_variants', 'promote_blueprint_variants',
    'generate_oral_exam', 'validate_oral_exam',
    'generate_learning_content', 'finalize_learning_content',
    'generate_lesson_minichecks'
  );

UPDATE job_queue
SET status = 'cancelled',
    last_error = 'OBSOLETE_X3_HEAL: cancel-loop terminated by manual heal',
    updated_at = now()
WHERE (payload->>'package_id') IN (
  'b960658d-95e9-4824-a404-821d5e9b5142',
  'eff99cc4-785d-4f61-a3ef-12932d8043c3',
  'fec61780-be73-4aca-a88e-1c6f1f39d412',
  '047bc325-5244-4f21-affd-5395bf62bcff',
  '335decc8-9f68-4784-b318-a68f620bf77e',
  '570ccb3e-2937-4d81-b3d8-624b9be84737'
)
AND status IN ('pending', 'queued')
AND created_at > now() - interval '24 hours';

UPDATE package_steps
SET meta = COALESCE(meta, '{}'::jsonb) - 'last_atomic_enqueue_at',
    updated_at = now()
WHERE package_id IN (
  'b960658d-95e9-4824-a404-821d5e9b5142',
  'eff99cc4-785d-4f61-a3ef-12932d8043c3',
  'fec61780-be73-4aca-a88e-1c6f1f39d412',
  '047bc325-5244-4f21-affd-5395bf62bcff',
  '335decc8-9f68-4784-b318-a68f620bf77e',
  '570ccb3e-2937-4d81-b3d8-624b9be84737'
)
AND status IN ('queued', 'pending_enqueue')
AND step_key IN ('run_integrity_check', 'quality_council', 'auto_publish', 'build_ai_tutor_index', 'validate_tutor_index');

INSERT INTO auto_heal_log (action_type, trigger_source, result_status, result_detail, target_type, target_id)
SELECT 'x3_cancel_loop_heal', 'manual_admin', 'success',
       jsonb_build_object('package_id', pid, 'pattern', 'approved_pool_saturated_with_cancel_loop')::text,
       'package', pid
FROM unnest(ARRAY[
  'b960658d-95e9-4824-a404-821d5e9b5142',
  'eff99cc4-785d-4f61-a3ef-12932d8043c3',
  'fec61780-be73-4aca-a88e-1c6f1f39d412',
  '047bc325-5244-4f21-affd-5395bf62bcff',
  '335decc8-9f68-4784-b318-a68f620bf77e',
  '570ccb3e-2937-4d81-b3d8-624b9be84737'
]) AS pid;

-- PHASE 2: Strukturfix
CREATE OR REPLACE FUNCTION public.fn_detect_and_heal_cancel_loop_x3()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_healed int := 0;
  v_skipped int := 0;
  v_cancelled int := 0;
  v_pkg record;
  v_count int;
BEGIN
  FOR v_pkg IN
    SELECT
      cp.id AS package_id, cp.title, cp.curriculum_id,
      (SELECT COUNT(*) FROM exam_questions eq WHERE eq.curriculum_id = cp.curriculum_id AND eq.qc_status='approved') AS approved_q,
      (SELECT COUNT(*) FROM job_queue jq
        WHERE (jq.payload->>'package_id') = cp.id::text
          AND jq.status='cancelled'
          AND jq.last_error LIKE 'UPSTREAM_CAUSALITY%'
          AND jq.created_at > now() - interval '1 hour') AS loop_count
    FROM course_packages cp
    WHERE cp.status = 'building'
  LOOP
    IF v_pkg.loop_count < 3 OR v_pkg.approved_q < 500 THEN CONTINUE; END IF;

    UPDATE package_steps
    SET status='skipped',
        finished_at = COALESCE(finished_at, now()),
        last_error = format('AUTO_SKIP_X3: approved_pool_saturated (%s questions, %s loop jobs)', v_pkg.approved_q, v_pkg.loop_count),
        updated_at = now()
    WHERE package_id = v_pkg.package_id
      AND status IN ('queued', 'pending_enqueue', 'blocked')
      AND step_key IN (
        'auto_seed_exam_blueprints', 'validate_blueprints',
        'generate_exam_pool', 'validate_exam_pool',
        'repair_exam_pool_quality',
        'generate_blueprint_variants', 'validate_blueprint_variants', 'promote_blueprint_variants',
        'generate_oral_exam', 'validate_oral_exam',
        'generate_learning_content', 'finalize_learning_content',
        'generate_lesson_minichecks'
      );
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_skipped := v_skipped + v_count;

    UPDATE job_queue
    SET status='cancelled', last_error='AUTO_HEAL_X3: cancel-loop terminated', updated_at=now()
    WHERE (payload->>'package_id') = v_pkg.package_id::text
      AND status IN ('pending', 'queued')
      AND created_at > now() - interval '24 hours';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_cancelled := v_cancelled + v_count;

    UPDATE package_steps
    SET meta = COALESCE(meta, '{}'::jsonb) - 'last_atomic_enqueue_at',
        updated_at = now()
    WHERE package_id = v_pkg.package_id
      AND status IN ('queued', 'pending_enqueue')
      AND step_key IN ('run_integrity_check', 'quality_council', 'auto_publish', 'build_ai_tutor_index', 'validate_tutor_index');

    INSERT INTO auto_heal_log (action_type, trigger_source, result_status, result_detail, target_type, target_id)
    VALUES ('x3_cancel_loop_auto_heal', 'cron_drift_detector_x3', 'success',
            jsonb_build_object('package_id', v_pkg.package_id, 'title', v_pkg.title,
                               'approved_q', v_pkg.approved_q, 'loop_count', v_pkg.loop_count)::text,
            'package', v_pkg.package_id::text);

    v_healed := v_healed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'packages_healed', v_healed,
    'steps_skipped', v_skipped,
    'jobs_cancelled', v_cancelled,
    'ts', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_detect_and_heal_cancel_loop_x3() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_detect_and_heal_cancel_loop_x3() TO service_role;

DO $$
BEGIN PERFORM cron.unschedule('cancel-loop-x3-heal-10min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'cancel-loop-x3-heal-10min',
  '*/10 * * * *',
  $$SELECT public.fn_detect_and_heal_cancel_loop_x3();$$
);