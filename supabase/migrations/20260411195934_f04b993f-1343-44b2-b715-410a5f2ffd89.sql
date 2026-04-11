
-- F2: Global fan-out cap — max 10 pending jobs of same type per package
CREATE OR REPLACE FUNCTION public.fn_enforce_global_fanout_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _pkg_id text;
  _pending_count int;
  _cap int := 10;
BEGIN
  -- Only act on new pending jobs
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  _pkg_id := NEW.payload->>'package_id';
  IF _pkg_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO _pending_count
  FROM job_queue
  WHERE payload->>'package_id' = _pkg_id
    AND job_type = NEW.job_type
    AND status = 'pending'
    AND id <> NEW.id;

  IF _pending_count >= _cap THEN
    NEW.status := 'cancelled';
    NEW.last_error := format('global_fanout_cap: %s pending jobs of type %s for package %s (cap=%s)',
      _pending_count, NEW.job_type, _pkg_id, _cap);
    RAISE LOG '[fanout_cap] Cancelled job % for package % (% pending of type %)',
      NEW.id, _pkg_id, _pending_count, NEW.job_type;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop if exists to avoid duplicate
DROP TRIGGER IF EXISTS trg_enforce_global_fanout_cap ON public.job_queue;

CREATE TRIGGER trg_enforce_global_fanout_cap
  BEFORE INSERT ON public.job_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_enforce_global_fanout_cap();
