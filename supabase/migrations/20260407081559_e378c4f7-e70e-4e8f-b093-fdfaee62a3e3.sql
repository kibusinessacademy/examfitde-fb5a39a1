
-- Guard: Auto-clear "Lease expired" errors on pending jobs
-- Root cause: Runner acquires lease but never executes, leaving job
-- in pending with an error that prevents re-pickup.

CREATE OR REPLACE FUNCTION public.fn_guard_lease_expired_auto_clear()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If job is (being set to) pending and has a "Lease expired" error,
  -- auto-clear the error so it's immediately eligible for pickup
  IF NEW.status = 'pending'
     AND NEW.error IS NOT NULL
     AND NEW.error ILIKE '%Lease expired%'
  THEN
    NEW.error := NULL;
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_lease_expired_auto_clear ON public.job_queue;

CREATE TRIGGER trg_guard_lease_expired_auto_clear
BEFORE INSERT OR UPDATE ON public.job_queue
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_lease_expired_auto_clear();
