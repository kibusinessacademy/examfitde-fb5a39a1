
-- Proactive reconciliation for quality_gate_failed packages with all gates green
CREATE OR REPLACE FUNCTION public.fn_reconcile_stale_qgf_packages()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pkg record;
  v_promoted int := 0;
  v_skipped int := 0;
  v_all_steps_done boolean;
  v_approved_q_count bigint;
  v_has_active_job boolean;
BEGIN
  FOR pkg IN
    SELECT cp.id, cp.curriculum_id, cp.integrity_passed, cp.council_approved,
           cp.integrity_report, cp.updated_at
    FROM course_packages cp
    WHERE cp.status = 'quality_gate_failed'
      AND cp.integrity_passed = true
      AND cp.council_approved = true
      AND cp.published_at IS NULL
    ORDER BY cp.priority ASC, cp.updated_at ASC
    LIMIT 5
  LOOP
    -- Debounce: skip if updated in last 2 minutes (let triggers settle)
    IF pkg.updated_at > now() - interval '2 minutes' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Check all functional steps are done (except auto_publish which needs building status)
    SELECT NOT EXISTS (
      SELECT 1 FROM package_steps ps
      WHERE ps.package_id = pkg.id
        AND ps.step_key NOT IN ('auto_publish')
        AND ps.status NOT IN ('done', 'skipped')
    ) INTO v_all_steps_done;

    IF NOT v_all_steps_done THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Check minimum approved questions
    IF pkg.curriculum_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_approved_q_count
      FROM exam_questions
      WHERE curriculum_id = pkg.curriculum_id AND status = 'approved';

      IF v_approved_q_count < 40 THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
    END IF;

    -- All gates green → transition back to building so auto_publish can run
    UPDATE course_packages
    SET status = 'building',
        blocked_reason = NULL,
        updated_at = now()
    WHERE id = pkg.id
      AND status = 'quality_gate_failed';

    -- Re-queue auto_publish step if not already queued
    UPDATE package_steps
    SET status = 'queued',
        started_at = NULL,
        finished_at = NULL,
        last_error = NULL,
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'qgf_reconcile_at', now()::text,
          'reconcile_reason', 'all_gates_green_auto_reentry'
        )
    WHERE package_id = pkg.id
      AND step_key = 'auto_publish'
      AND status NOT IN ('done', 'running', 'processing');

    -- Log
    INSERT INTO auto_heal_log (action_type, trigger_source, result_status, result_detail, target_id, target_type, metadata)
    VALUES ('QGF_RECONCILE_TO_BUILDING', 'fn_reconcile_stale_qgf_packages', 'success',
      'Promoted quality_gate_failed → building (all gates green, auto_publish pending)',
      pkg.id::text, 'course_package',
      jsonb_build_object(
        'integrity_passed', pkg.integrity_passed,
        'council_approved', pkg.council_approved,
        'approved_questions', v_approved_q_count
      ));

    v_promoted := v_promoted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'promoted', v_promoted,
    'skipped', v_skipped,
    'run_at', now()::text
  );
END;
$$;
