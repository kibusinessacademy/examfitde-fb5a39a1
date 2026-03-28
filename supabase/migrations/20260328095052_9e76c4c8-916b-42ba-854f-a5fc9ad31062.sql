-- Narrow the reconciliation trigger to only fire on relevant column changes
-- Previously it fired on EVERY update to course_packages, now only when
-- status, integrity_passed, council_approved, or build_progress change.

CREATE OR REPLACE FUNCTION public.trg_reconcile_stale_quality_gate_failed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_all_steps_done boolean;
  v_approved_q_count bigint;
  v_curriculum_id uuid;
BEGIN
  -- Only act on quality_gate_failed packages
  IF NEW.status <> 'quality_gate_failed' THEN
    RETURN NEW;
  END IF;

  -- NARROW SCOPE: Only fire when a relevant column actually changed
  -- This prevents unnecessary evaluation on unrelated updates
  IF OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.integrity_passed IS NOT DISTINCT FROM NEW.integrity_passed
     AND OLD.council_approved IS NOT DISTINCT FROM NEW.council_approved
     AND OLD.build_progress IS NOT DISTINCT FROM NEW.build_progress
  THEN
    RETURN NEW;
  END IF;

  -- Check hard gates
  IF NOT COALESCE(NEW.integrity_passed, false) THEN
    RETURN NEW;
  END IF;
  IF NOT COALESCE(NEW.council_approved, false) THEN
    RETURN NEW;
  END IF;

  -- Check all functional steps are done
  SELECT NOT EXISTS (
    SELECT 1 FROM package_steps
    WHERE package_id = NEW.id
      AND status NOT IN ('done', 'skipped')
  ) INTO v_all_steps_done;

  IF NOT v_all_steps_done THEN
    RETURN NEW;
  END IF;

  -- Check approved question count
  SELECT curriculum_id INTO v_curriculum_id FROM course_packages WHERE id = NEW.id;
  IF v_curriculum_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_approved_q_count
    FROM exam_questions
    WHERE curriculum_id = v_curriculum_id AND status = 'approved';

    IF v_approved_q_count < 40 THEN
      RETURN NEW;
    END IF;
  END IF;

  -- All gates green — promote to published
  NEW.status := 'published';
  NEW.published_at := COALESCE(NEW.published_at, now());
  NEW.blocked_reason := NULL;

  -- Log the reconciliation
  INSERT INTO auto_heal_log (action_type, trigger_source, result_status, result_detail, target_id, target_type, metadata)
  VALUES ('stale_qgf_reconciliation', 'trg_reconcile_stale_quality_gate_failed', 'success',
    'Auto-promoted from quality_gate_failed to published — all gates green',
    NEW.id::text, 'course_package',
    jsonb_build_object(
      'integrity_passed', NEW.integrity_passed,
      'council_approved', NEW.council_approved,
      'approved_questions', v_approved_q_count,
      'trigger_reason', CASE
        WHEN OLD.status IS DISTINCT FROM NEW.status THEN 'status_change'
        WHEN OLD.integrity_passed IS DISTINCT FROM NEW.integrity_passed THEN 'integrity_change'
        WHEN OLD.council_approved IS DISTINCT FROM NEW.council_approved THEN 'council_change'
        WHEN OLD.build_progress IS DISTINCT FROM NEW.build_progress THEN 'progress_change'
        ELSE 'unknown'
      END
    ));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reconcile_stale_quality_gate_failed ON course_packages;
CREATE TRIGGER trg_reconcile_stale_quality_gate_failed
  BEFORE UPDATE ON course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_reconcile_stale_quality_gate_failed();