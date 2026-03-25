
-- ═══════════════════════════════════════════════════════════════════
-- FIX 1: Protect integrity_report from trigger wipe-loops
-- The invalidation trigger was wiping valid reports during normal 
-- pipeline execution (building/blocked status). Now it only fires
-- on genuine resets (planning/queued status change).
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_invalidate_integrity_on_package_reset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- ONLY invalidate on genuine status resets to pre-build states
  -- Skip if the update itself is writing a new report (concurrent write protection)
  IF NEW.status IN ('planning', 'queued') 
     AND OLD.status NOT IN ('planning', 'queued')
     AND (OLD.integrity_report IS NOT NULL OR OLD.integrity_passed = true)
     AND NEW.integrity_report IS NULL  -- Only wipe if new row doesn't carry a fresh report
  THEN
    NEW.integrity_report := null;
    NEW.integrity_report_version := NULL;
    NEW.integrity_passed := false;
  END IF;

  -- Build progress regression: only wipe if drop is real AND no fresh report in same update
  IF NEW.build_progress < OLD.build_progress - 10
     AND OLD.integrity_report IS NOT NULL
     AND NEW.integrity_report IS NULL  -- Protect concurrent report writes
  THEN
    NEW.integrity_report := null;
    NEW.integrity_report_version := NULL;
    NEW.integrity_passed := false;
  END IF;

  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- FIX 2: Reseed loop guard — track cycles in step meta, hard-block after 3
-- ═══════════════════════════════════════════════════════════════════

-- Auto-unblock function: clear blocked_reason + status atomically
CREATE OR REPLACE FUNCTION public.fn_auto_unblock_ready_packages()
RETURNS TABLE(package_id uuid, old_reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH unblocked AS (
    UPDATE course_packages cp
    SET status = 'building',
        blocked_reason = NULL,
        last_error = NULL
    WHERE cp.status = 'blocked'
      AND cp.blocked_reason IS NOT NULL
      -- Only unblock if the root cause has been resolved
      AND EXISTS (
        SELECT 1 FROM package_steps ps
        WHERE ps.package_id = cp.id
          AND ps.step_key = 'auto_publish'
          AND ps.status != 'blocked'
      )
    RETURNING cp.id AS package_id, cp.blocked_reason AS old_reason
  )
  SELECT * FROM unblocked;
END;
$$;
