
-- ============================================================
-- Bulk-Heal RPC für blocked Pakete der Klasse NO_STEP_HISTORY
-- ------------------------------------------------------------
-- Heuristik: blocked + 0 active jobs + approved questions >= 100
-- → blocked_reason clearen, status → building, queued tail-step
--   pro Paket atomar antriggern (oldest queued step zuerst).
-- Dry-Run liefert Plan ohne Mutation.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_bulk_heal_no_step_history(
  p_dry_run boolean DEFAULT true,
  p_package_ids uuid[] DEFAULT NULL,
  p_min_approved int DEFAULT 100
)
RETURNS TABLE (
  package_id uuid,
  action text,
  prev_status text,
  prev_blocked_reason text,
  next_status text,
  approved_q int,
  active_jobs int,
  next_step text,
  notes text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg record;
  v_next_step text;
  v_approved int;
  v_active int;
  v_action text;
BEGIN
  FOR v_pkg IN
    SELECT cp.id, cp.status, cp.blocked_reason
    FROM course_packages cp
    WHERE cp.status = 'blocked'
      AND (p_package_ids IS NULL OR cp.id = ANY(p_package_ids))
  LOOP
    SELECT count(*) INTO v_approved
      FROM exam_questions WHERE package_id = v_pkg.id AND status='approved';
    SELECT count(*) INTO v_active
      FROM job_queue WHERE package_id = v_pkg.id AND status IN ('queued','running');

    -- Eligibility-Gate
    IF v_active > 0 THEN
      package_id := v_pkg.id;
      action := 'skip';
      prev_status := v_pkg.status;
      prev_blocked_reason := v_pkg.blocked_reason;
      next_status := v_pkg.status;
      approved_q := v_approved;
      active_jobs := v_active;
      next_step := NULL;
      notes := 'active jobs exist';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF v_approved < p_min_approved THEN
      package_id := v_pkg.id;
      action := 'skip';
      prev_status := v_pkg.status;
      prev_blocked_reason := v_pkg.blocked_reason;
      next_status := v_pkg.status;
      approved_q := v_approved;
      active_jobs := v_active;
      next_step := NULL;
      notes := 'approved questions below threshold';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Wähle nächsten queued Tail-Step (deterministisch)
    SELECT ps.step_key INTO v_next_step
    FROM package_steps ps
    WHERE ps.package_id = v_pkg.id
      AND ps.status IN ('queued','pending_enqueue')
    ORDER BY
      CASE ps.step_key
        WHEN 'run_integrity_check' THEN 1
        WHEN 'repair_exam_pool_quality' THEN 2
        WHEN 'validate_exam_pool' THEN 3
        WHEN 'quality_council' THEN 4
        WHEN 'elite_harden' THEN 5
        WHEN 'generate_oral_exam' THEN 6
        WHEN 'validate_oral_exam' THEN 7
        WHEN 'build_ai_tutor_index' THEN 8
        WHEN 'validate_tutor_index' THEN 9
        WHEN 'auto_publish' THEN 10
        ELSE 99
      END,
      ps.updated_at ASC
    LIMIT 1;

    v_action := CASE WHEN p_dry_run THEN 'plan' ELSE 'heal' END;

    IF NOT p_dry_run THEN
      -- Status & Reason atomar entkoppeln (Invariante: building hat keinen blocked_reason)
      UPDATE course_packages
      SET status = 'building',
          blocked_reason = NULL,
          updated_at = now()
      WHERE id = v_pkg.id;

      -- pending_enqueue → queued normalisieren (nur falls obsolet, approved>min)
      UPDATE package_steps
      SET status = 'queued', updated_at = now()
      WHERE package_id = v_pkg.id AND status = 'pending_enqueue';

      INSERT INTO auto_heal_log (action_type, package_id, payload, created_at)
      VALUES (
        'bulk_heal_no_step_history',
        v_pkg.id,
        jsonb_build_object(
          'prev_status', v_pkg.status,
          'prev_blocked_reason', v_pkg.blocked_reason,
          'approved_q', v_approved,
          'active_jobs', v_active,
          'next_step', v_next_step,
          'min_approved', p_min_approved
        ),
        now()
      );
    END IF;

    package_id := v_pkg.id;
    action := v_action;
    prev_status := v_pkg.status;
    prev_blocked_reason := v_pkg.blocked_reason;
    next_status := CASE WHEN p_dry_run THEN v_pkg.status ELSE 'building' END;
    approved_q := v_approved;
    active_jobs := v_active;
    next_step := v_next_step;
    notes := 'cleared blocked_reason, status→building, normalized pending_enqueue→queued';
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_bulk_heal_no_step_history(boolean, uuid[], int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_bulk_heal_no_step_history(boolean, uuid[], int) TO authenticated, service_role;
