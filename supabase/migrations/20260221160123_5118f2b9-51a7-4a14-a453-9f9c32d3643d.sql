
-- Restore trg_enforce_jsonb_number_config with original body + search_path fix
CREATE OR REPLACE FUNCTION public.trg_enforce_jsonb_number_config()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- For numeric config keys, ensure value is stored as JSONB number, not string
  IF NEW.key IN ('max_concurrent_packages', 'autoscale_target_max', 'autoscale_floor', 
                  'heartbeat_stale_seconds', 'backpressure_threshold') THEN
    IF jsonb_typeof(NEW.value) = 'string' THEN
      -- Auto-correct: convert JSONB string to JSONB number
      NEW.value := to_jsonb((NEW.value #>> '{}')::int);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
