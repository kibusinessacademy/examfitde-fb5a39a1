
-- Permanent WIP-Cap enforcement trigger on course_packages
-- This is the ONLY systemwide hard gate that prevents building count > cap.
CREATE OR REPLACE FUNCTION public.fn_enforce_wip_cap_on_building()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wip_cap int := 18;
  v_current_building int;
  v_cfg_val text;
BEGIN
  -- Only fire on transition TO building
  IF NEW.status <> 'building' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'building' THEN
    RETURN NEW; -- already building, no-op
  END IF;

  -- Read configurable cap
  BEGIN
    SELECT value INTO v_cfg_val
    FROM ops_pipeline_config
    WHERE key = 'wip_total_cap'
    LIMIT 1;
    IF v_cfg_val IS NOT NULL THEN
      v_wip_cap := v_cfg_val::int;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- fallback to 18
    NULL;
  END;

  -- Count current building packages (excluding this one in case of re-trigger)
  SELECT count(*) INTO v_current_building
  FROM course_packages
  WHERE status = 'building'
    AND id <> NEW.id;

  IF v_current_building >= v_wip_cap THEN
    RAISE EXCEPTION 'WIP_CAP_EXCEEDED: % building packages already at cap %. Cannot transition package % to building.',
      v_current_building, v_wip_cap, NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop if exists to make idempotent
DROP TRIGGER IF EXISTS trg_enforce_wip_cap ON course_packages;

CREATE TRIGGER trg_enforce_wip_cap
  BEFORE UPDATE ON course_packages
  FOR EACH ROW
  EXECUTE FUNCTION fn_enforce_wip_cap_on_building();
