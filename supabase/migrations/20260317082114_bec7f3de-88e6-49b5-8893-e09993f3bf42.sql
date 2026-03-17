
-- ═══════════════════════════════════════════════════════════════════
-- INVARIANT GUARD: course_packages status/blocked_reason consistency
-- ═══════════════════════════════════════════════════════════════════
-- Rule 1: blocked_reason IS NOT NULL => status MUST be 'blocked'
-- Rule 2: status = 'queued' => blocked_reason MUST be NULL
-- This prevents "poisoned" packages from corrupting priority gating.

CREATE OR REPLACE FUNCTION trg_enforce_package_status_blocked_invariant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- If blocked_reason is being set but status isn't 'blocked', force it
  IF NEW.blocked_reason IS NOT NULL AND NEW.status NOT IN ('blocked', 'cancelled', 'archived') THEN
    NEW.status := 'blocked';
    RAISE WARNING '[invariant-guard] Forced status=blocked for package % (was %) because blocked_reason is set: %',
      NEW.id, NEW.status, left(NEW.blocked_reason, 100);
  END IF;

  -- If status is being set to 'queued' or 'building', clear any stale blocked_reason
  IF NEW.status IN ('queued', 'building') AND NEW.blocked_reason IS NOT NULL THEN
    NEW.blocked_reason := NULL;
    RAISE WARNING '[invariant-guard] Cleared stale blocked_reason for package % transitioning to %',
      NEW.id, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop if exists to ensure clean re-creation
DROP TRIGGER IF EXISTS trg_enforce_package_status_blocked ON course_packages;

CREATE TRIGGER trg_enforce_package_status_blocked
  BEFORE INSERT OR UPDATE ON course_packages
  FOR EACH ROW
  EXECUTE FUNCTION trg_enforce_package_status_blocked_invariant();

-- Log this guard creation
INSERT INTO auto_heal_log (action_type, trigger_source, target_type, result_status, result_detail)
VALUES ('create_invariant_guard', 'admin_manual', 'course_packages', 'ok',
        'Added trg_enforce_package_status_blocked: enforces blocked_reason<->status consistency');
