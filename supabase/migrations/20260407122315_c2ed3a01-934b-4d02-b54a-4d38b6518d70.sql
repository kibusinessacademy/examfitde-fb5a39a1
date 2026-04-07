
-- Guard: Auto-sync worker_pool from job_type_policies on INSERT/UPDATE
CREATE OR REPLACE FUNCTION public.fn_guard_sync_worker_pool()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _policy_pool text;
BEGIN
  -- Look up the canonical pool from job_type_policies
  SELECT worker_pool INTO _policy_pool
  FROM job_type_policies
  WHERE job_type = NEW.job_type;

  -- Default to 'default' if no policy exists
  _policy_pool := COALESCE(_policy_pool, 'default');

  -- If the incoming pool differs, auto-correct and tag meta
  IF COALESCE(NEW.worker_pool, 'default') IS DISTINCT FROM _policy_pool THEN
    -- Log the correction in meta (merge, never overwrite)
    NEW.meta := COALESCE(NEW.meta, '{}'::jsonb) || jsonb_build_object(
      'pool_autosynced', true,
      'pool_original', NEW.worker_pool,
      'pool_corrected_to', _policy_pool,
      'pool_synced_at', now()::text
    );
    NEW.worker_pool := _policy_pool;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop if exists to be safe
DROP TRIGGER IF EXISTS trg_guard_sync_worker_pool ON job_queue;

-- Create trigger for both INSERT and UPDATE
CREATE TRIGGER trg_guard_sync_worker_pool
  BEFORE INSERT OR UPDATE OF worker_pool, job_type
  ON job_queue
  FOR EACH ROW
  EXECUTE FUNCTION fn_guard_sync_worker_pool();

-- Add a comment for documentation
COMMENT ON FUNCTION fn_guard_sync_worker_pool() IS 
  'Dauermaßnahme: Auto-syncs worker_pool from job_type_policies SSOT. Prevents pool mismatch stalls system-wide.';
