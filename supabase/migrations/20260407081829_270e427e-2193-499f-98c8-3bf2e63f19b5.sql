
-- Guard: Auto-cancel jobs for non-building packages
-- These jobs are picked up repeatedly by the runner, get the OPS_GUARD error,
-- and stay in pending - wasting runner cycles every loop.

CREATE OR REPLACE FUNCTION public.fn_guard_non_building_auto_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If job is pending with NON_BUILDING_PACKAGE error, auto-cancel it
  -- The reconciler will re-create the job when the package returns to building
  IF NEW.status = 'pending'
     AND NEW.error IS NOT NULL
     AND NEW.error ILIKE '%NON_BUILDING_PACKAGE%'
  THEN
    NEW.status := 'cancelled';
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_non_building_auto_cancel ON public.job_queue;

CREATE TRIGGER trg_guard_non_building_auto_cancel
BEFORE UPDATE ON public.job_queue
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_non_building_auto_cancel();
