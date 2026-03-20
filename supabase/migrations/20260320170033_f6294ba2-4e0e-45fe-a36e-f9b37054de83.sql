-- Invariant guard: integrity_report_version set => integrity_report must not be NULL
-- Prevents silent persistence defects where version is written but report body is lost.
CREATE OR REPLACE FUNCTION trg_guard_integrity_report_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- Guard: if version is set, report body must exist
  IF NEW.integrity_report_version IS NOT NULL AND NEW.integrity_report IS NULL THEN
    -- Allow if we're explicitly clearing both (reset scenario)
    IF NEW.integrity_report_version IS DISTINCT FROM OLD.integrity_report_version THEN
      RAISE EXCEPTION 'INTEGRITY_REPORT_INVARIANT_VIOLATION: integrity_report_version=% but integrity_report is NULL. Report must be persisted alongside version.',
        NEW.integrity_report_version;
    END IF;
    -- If version didn't change, allow (e.g. updating status on a package that already had stale version)
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_integrity_report_consistency ON course_packages;
CREATE TRIGGER trg_guard_integrity_report_consistency
  BEFORE UPDATE ON course_packages
  FOR EACH ROW
  EXECUTE FUNCTION trg_guard_integrity_report_consistency();