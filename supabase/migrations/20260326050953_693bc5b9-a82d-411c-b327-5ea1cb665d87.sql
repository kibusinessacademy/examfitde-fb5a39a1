
-- P0 REPAIR PACK: Blocked Package Recovery (fixed)
-- =============================================

-- 1. Harden fn_auto_unblock_ready_packages to check ALL gates
CREATE OR REPLACE FUNCTION public.fn_auto_unblock_ready_packages()
  RETURNS TABLE(package_id uuid, old_reason text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT cp.id, cp.blocked_reason
    FROM course_packages cp
    WHERE cp.status = 'blocked'
      AND cp.blocked_reason IS NOT NULL
      AND cp.integrity_passed = true
      AND cp.council_approved = true
      AND NOT EXISTS (
        SELECT 1 FROM package_steps ps
        WHERE ps.package_id = cp.id
          AND ps.status NOT IN ('done', 'skipped')
          AND ps.step_key != 'auto_publish'
      )
  ),
  unblocked AS (
    UPDATE course_packages cp
    SET status = 'building',
        blocked_reason = NULL,
        last_error = NULL
    FROM candidates c
    WHERE cp.id = c.id
    RETURNING cp.id AS package_id, c.blocked_reason AS old_reason
  )
  SELECT u.package_id, u.old_reason FROM unblocked u;
END;
$function$;

-- 2. Add status invariant view: detect BLOCKED_BUT_READY anomalies
CREATE OR REPLACE VIEW public.ops_blocked_but_ready AS
SELECT
  cp.id AS package_id,
  c.title,
  cp.status,
  cp.blocked_reason,
  cp.integrity_passed,
  cp.council_approved,
  cp.build_progress,
  cp.updated_at,
  (SELECT count(*) FROM package_steps ps 
   WHERE ps.package_id = cp.id 
   AND ps.status NOT IN ('done','skipped')
   AND ps.step_key != 'auto_publish') AS non_done_steps
FROM course_packages cp
JOIN courses c ON c.id = cp.course_id
WHERE cp.status = 'blocked'
  AND cp.blocked_reason IS NOT NULL
  AND cp.integrity_passed = true
  AND cp.council_approved = true;

-- 3. Heal all 3 packages: clear stale blocks
UPDATE course_packages
SET status = 'building',
    blocked_reason = NULL,
    last_error = NULL
WHERE id IN (
  'a9f19137-a004-4850-838a-bdc8f8a705f5',
  '9c1b3734-bb25-4986-baef-5bb1c20a212c',
  'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
)
AND status = 'blocked';

-- 4. Reset integrity + auto_publish steps for the two with missing reports
UPDATE package_steps
SET status = 'queued', last_error = NULL
WHERE package_id IN (
  '9c1b3734-bb25-4986-baef-5bb1c20a212c',
  'fd1d8192-a16f-496b-80c8-5e06f70ec21a'
)
AND step_key IN ('run_integrity_check', 'auto_publish');

-- 5. Log healing
INSERT INTO auto_heal_log (action_type, target_id, target_type, trigger_source, result_status, result_detail)
VALUES 
  ('p0_repair_unblock', 'a9f19137-a004-4850-838a-bdc8f8a705f5', 'course_package', 'manual_forensic_repair', 'applied',
   'STALE_BLOCK_HEALED: All gates passed but status was blocked with QG_HEAL_EXHAUSTED'),
  ('p0_repair_unblock', '9c1b3734-bb25-4986-baef-5bb1c20a212c', 'course_package', 'manual_forensic_repair', 'applied',
   'INTEGRITY_LOOP_HEALED: integrity_report NULL due to MATERIALIZATION_GUARD. Block cleared, steps reset.'),
  ('p0_repair_unblock', 'fd1d8192-a16f-496b-80c8-5e06f70ec21a', 'course_package', 'manual_forensic_repair', 'applied',
   'INTEGRITY_LOOP_HEALED: integrity_report NULL due to MATERIALIZATION_GUARD. Block cleared, steps reset.');

-- 6. Notify pgrst about new view
NOTIFY pgrst, 'reload schema';
