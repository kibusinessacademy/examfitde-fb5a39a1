
-- PATCH A: Guard trigger to prevent quality_council step reset when all sessions terminal
CREATE OR REPLACE FUNCTION guard_council_step_reset()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_non_terminal int;
BEGIN
  IF NEW.step_key <> 'quality_council' OR NEW.status <> 'queued' OR OLD.status <> 'done' THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_non_terminal FROM council_sessions
  WHERE package_id = NEW.package_id AND status NOT IN ('completed', 'cancelled', 'skipped');
  IF v_non_terminal = 0 THEN
    PERFORM 1 FROM council_sessions WHERE package_id = NEW.package_id LIMIT 1;
    IF FOUND THEN RETURN OLD; END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_guard_council_step_reset ON package_steps;
CREATE TRIGGER trg_guard_council_step_reset
  BEFORE UPDATE ON package_steps FOR EACH ROW EXECUTE FUNCTION guard_council_step_reset();

-- PATCH B: Reconcile quality_council steps (with started_at + attempts for ghost guard)
UPDATE package_steps
SET status = 'done', started_at = COALESCE(started_at, now()), attempts = GREATEST(attempts, 1), updated_at = now()
WHERE package_id IN (
  '59b6e214-e181-4c2b-986e-1ce544984d04',
  '2e8da39f-60f8-44d9-8b70-e1176222ca55',
  '9c1b3734-bb25-4986-baef-5bb1c20a212c'
) AND step_key = 'quality_council' AND status <> 'done';

UPDATE course_packages
SET council_approved = true, council_approved_at = COALESCE(council_approved_at, now()), updated_at = now()
WHERE id IN (
  '59b6e214-e181-4c2b-986e-1ce544984d04',
  '2e8da39f-60f8-44d9-8b70-e1176222ca55',
  '9c1b3734-bb25-4986-baef-5bb1c20a212c'
) AND council_approved IS NOT TRUE;

-- PATCH C: Unblock Elektroniker
UPDATE course_packages
SET integrity_report_version = NULL, integrity_passed = false,
    blocked_reason = NULL, status = 'building', updated_at = now()
WHERE id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a' AND status = 'blocked';

UPDATE package_steps SET status = 'queued', updated_at = now()
WHERE package_id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
AND step_key = 'run_integrity_check' AND status = 'done';

UPDATE package_steps SET status = 'queued', updated_at = now()
WHERE package_id = 'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
AND step_key = 'auto_publish' AND status NOT IN ('queued');
