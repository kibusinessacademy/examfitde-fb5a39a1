
-- ══════════════════════════════════════════════════════════════
-- FIX 1: Guard against "ghost finalization" — steps marked done
-- without ever being started (started_at IS NULL, attempts = 0)
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION guard_ghost_step_finalization()
RETURNS TRIGGER AS $$
BEGIN
  -- Only guard transitions TO 'done'
  IF NEW.status <> 'done' THEN RETURN NEW; END IF;
  IF OLD.status = 'done' THEN RETURN NEW; END IF; -- already done, allow metadata updates

  -- Block if step was never started AND has 0 attempts
  -- Exception: steps explicitly approved via exception_approved
  IF NEW.started_at IS NULL AND NEW.attempts = 0 AND NOT COALESCE(NEW.exception_approved, false) THEN
    RAISE EXCEPTION 'GHOST_FINALIZATION_BLOCKED: step % cannot be marked done without started_at or attempts > 0', NEW.step_key;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_ghost_step_finalization ON package_steps;
CREATE TRIGGER trg_guard_ghost_step_finalization
  BEFORE UPDATE ON package_steps
  FOR EACH ROW
  EXECUTE FUNCTION guard_ghost_step_finalization();

-- ══════════════════════════════════════════════════════════════
-- FIX 2: Guard course status drift — course cannot be "published"
-- if latest active package is NOT published/done
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION sync_course_status_on_package_change()
RETURNS TRIGGER AS $$
DECLARE
  v_course_id uuid;
  v_latest_pkg_status text;
BEGIN
  v_course_id := NEW.course_id;
  
  -- Find the latest non-archived package status for this course
  SELECT status INTO v_latest_pkg_status
  FROM course_packages
  WHERE course_id = v_course_id
    AND status NOT IN ('archived', 'superseded')
  ORDER BY version DESC, created_at DESC
  LIMIT 1;

  IF v_latest_pkg_status IS NULL THEN RETURN NEW; END IF;

  -- Sync course status based on latest package
  IF v_latest_pkg_status = 'published' THEN
    UPDATE courses SET status = 'published' WHERE id = v_course_id AND status <> 'published';
  ELSIF v_latest_pkg_status IN ('quality_gate_failed', 'failed', 'blocked') THEN
    UPDATE courses SET status = 'draft' WHERE id = v_course_id AND status = 'published';
  ELSIF v_latest_pkg_status = 'building' THEN
    UPDATE courses SET status = 'generating' WHERE id = v_course_id AND status NOT IN ('generating', 'published');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_course_status_on_package ON course_packages;
CREATE TRIGGER trg_sync_course_status_on_package
  AFTER UPDATE OF status ON course_packages
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION sync_course_status_on_package_change();
