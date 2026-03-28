
-- ═══════════════════════════════════════════════════════════════
-- DAUERFIX: auto_publish False-Success Prevention & Reconciliation
-- ═══════════════════════════════════════════════════════════════

-- 1) AUDIT VIEW: Detect auto_publish=done but package NOT published
--    This is the exact anomaly class that caused the P0 incident.
CREATE OR REPLACE VIEW public.ops_auto_publish_false_success AS
SELECT
  cp.id AS package_id,
  cp.title,
  cp.status AS package_status,
  cp.integrity_passed,
  cp.council_approved,
  cp.build_progress,
  cp.published_at,
  ps.status AS auto_publish_step_status,
  ps.last_error AS auto_publish_last_error,
  ps.finished_at AS auto_publish_finished_at,
  ps.meta AS auto_publish_meta,
  cp.updated_at
FROM course_packages cp
JOIN package_steps ps
  ON ps.package_id = cp.id
 AND ps.step_key = 'auto_publish'
WHERE
  ps.status = 'done'
  AND cp.status <> 'published'
  AND cp.status <> 'archived';

-- 2) TRIGGER: Prevent auto_publish step from being set to 'done' 
--    unless the package is actually published.
--    This is the structural fix — eliminates the False-Success class entirely.
CREATE OR REPLACE FUNCTION public.trg_guard_auto_publish_done()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_pkg_status text;
BEGIN
  -- Only guard auto_publish step transitions to 'done'
  IF NEW.step_key <> 'auto_publish' THEN
    RETURN NEW;
  END IF;
  IF NEW.status <> 'done' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'done' THEN
    RETURN NEW; -- already done, no-op update
  END IF;

  -- Check actual package status
  SELECT status INTO v_pkg_status
  FROM course_packages
  WHERE id = NEW.package_id;

  IF v_pkg_status IS DISTINCT FROM 'published' THEN
    -- Block the transition — this is a false success
    RAISE WARNING '[GUARD] auto_publish step blocked from done: package % status is % (expected published)',
      NEW.package_id, COALESCE(v_pkg_status, 'NULL');
    NEW.status := 'failed';
    NEW.last_error := 'POST_CONDITION_FAILED: package status is ' || COALESCE(v_pkg_status, 'NULL') || ' (expected published)';
    NEW.meta := jsonb_build_object(
      'guard', 'trg_guard_auto_publish_done',
      'actual_status', v_pkg_status,
      'expected_status', 'published',
      'blocked_at', now()::text
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_auto_publish_done ON package_steps;
CREATE TRIGGER trg_guard_auto_publish_done
  BEFORE UPDATE ON package_steps
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_guard_auto_publish_done();

-- 3) RECONCILIATION: Auto-clear stale quality_gate_failed when all gates are green
--    This trigger fires on course_packages updates and promotes eligible packages.
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
    jsonb_build_object('integrity_passed', NEW.integrity_passed, 'council_approved', NEW.council_approved, 'approved_questions', v_approved_q_count));

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reconcile_stale_quality_gate_failed ON course_packages;
CREATE TRIGGER trg_reconcile_stale_quality_gate_failed
  BEFORE UPDATE ON course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_reconcile_stale_quality_gate_failed();

-- 4) VIEW: Packages eligible for publish but stuck in wrong status
--    Operational dashboard for the Leitstelle
CREATE OR REPLACE VIEW public.ops_publish_eligible_but_stuck AS
SELECT
  cp.id AS package_id,
  cp.title,
  cp.status,
  cp.blocked_reason,
  cp.integrity_passed,
  cp.council_approved,
  cp.build_progress,
  cp.updated_at,
  (SELECT COUNT(*) FROM package_steps WHERE package_id = cp.id AND status NOT IN ('done', 'skipped')) AS open_steps,
  (SELECT COUNT(*) FROM exam_questions eq 
   JOIN curricula c ON c.id = eq.curriculum_id 
   WHERE c.id = cp.curriculum_id AND eq.status = 'approved') AS approved_questions
FROM course_packages cp
WHERE
  cp.status NOT IN ('published', 'archived')
  AND COALESCE(cp.integrity_passed, false) = true
  AND COALESCE(cp.council_approved, false) = true
  AND NOT EXISTS (
    SELECT 1 FROM package_steps
    WHERE package_id = cp.id
      AND status NOT IN ('done', 'skipped')
  );
