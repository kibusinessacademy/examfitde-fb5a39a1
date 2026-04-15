-- Guard: package_% jobs MUST have package_id
CREATE OR REPLACE FUNCTION public.trg_guard_package_job_has_package_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.job_type LIKE 'package_%' AND NEW.package_id IS NULL THEN
    -- Try to extract from payload as fallback
    IF NEW.payload IS NOT NULL AND (NEW.payload->>'package_id') IS NOT NULL THEN
      NEW.package_id := (NEW.payload->>'package_id')::uuid;
    ELSE
      RAISE EXCEPTION 'SSOT_GUARD: job_type "%" requires package_id but none provided', NEW.job_type;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_job_queue_package_id_guard ON job_queue;
CREATE TRIGGER trg_job_queue_package_id_guard
  BEFORE INSERT ON job_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_guard_package_job_has_package_id();