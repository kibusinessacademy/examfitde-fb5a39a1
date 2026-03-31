
-- Fix 1: Extend trigger to fire on INSERT OR UPDATE
DROP TRIGGER IF EXISTS trg_council_session_materialize_approval ON public.council_sessions;
CREATE TRIGGER trg_council_session_materialize_approval
  AFTER INSERT OR UPDATE ON public.council_sessions
  FOR EACH ROW
  EXECUTE FUNCTION trg_materialize_council_approval();

-- Fix 2: Direct reconciliation (bypass ambiguous function)
UPDATE course_packages cp
SET council_approved = true, council_approved_at = COALESCE(cp.council_approved_at, now()), updated_at = now()
WHERE cp.council_approved IS NOT TRUE
  AND NOT EXISTS (SELECT 1 FROM council_sessions cs WHERE cs.package_id = cp.id AND cs.status NOT IN ('completed','cancelled','skipped'))
  AND EXISTS (SELECT 1 FROM council_sessions cs WHERE cs.package_id = cp.id);

UPDATE package_steps ps
SET status = 'done', started_at = COALESCE(ps.started_at, now()), attempts = GREATEST(ps.attempts, 1), updated_at = now()
WHERE ps.step_key = 'quality_council' AND ps.status <> 'done'
  AND EXISTS (SELECT 1 FROM course_packages cp WHERE cp.id = ps.package_id AND cp.council_approved = true);
