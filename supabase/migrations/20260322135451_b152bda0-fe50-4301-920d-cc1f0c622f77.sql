
-- Harden trg_invalidate_integrity_on_package_reset:
-- Skip invalidation if the UPDATE is explicitly writing a new integrity_report.
-- This prevents the trigger from stripping a freshly written report in the same transaction.
CREATE OR REPLACE FUNCTION public.trg_invalidate_integrity_on_package_reset()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- GUARD: If this update explicitly writes a new integrity_report, do NOT invalidate.
  -- This prevents the trigger-strip defect where a freshly written report is immediately cleared.
  IF NEW.integrity_report IS NOT NULL AND (OLD.integrity_report IS DISTINCT FROM NEW.integrity_report) THEN
    RETURN NEW;
  END IF;

  -- Invalidate on status reset to planning/queued or significant build_progress drop
  IF (
    NEW.status IN ('planning', 'queued')
    OR (
      OLD.build_progress IS NOT NULL
      AND NEW.build_progress IS NOT NULL
      AND NEW.build_progress < OLD.build_progress - 10
    )
  ) THEN
    NEW.integrity_report := NULL;
    NEW.integrity_version := NULL;
    NEW.integrity_report_version := NULL;
    NEW.integrity_report_version_num := NULL;
    NEW.integrity_passed := false;
  END IF;

  RETURN NEW;
END;
$$;
