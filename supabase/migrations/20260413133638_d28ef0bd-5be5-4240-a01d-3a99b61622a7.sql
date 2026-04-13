
-- Replace the WIP enforcement function with race-condition-safe version
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
  -- For UPDATE: skip if already building
  IF TG_OP = 'UPDATE' AND OLD.status = 'building' THEN
    RETURN NEW;
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
    NULL;
  END;

  -- Race-safe count: lock all building rows to serialize concurrent transitions
  SELECT count(*) INTO v_current_building
  FROM course_packages
  WHERE status = 'building'
    AND id <> NEW.id
  FOR UPDATE;

  IF v_current_building >= v_wip_cap THEN
    RAISE EXCEPTION 'WIP_CAP_EXCEEDED: % building packages already at cap %. Cannot transition package % to building.',
      v_current_building, v_wip_cap, NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger and re-create for both INSERT and UPDATE
DROP TRIGGER IF EXISTS trg_enforce_wip_cap ON course_packages;

CREATE TRIGGER trg_enforce_wip_cap
  BEFORE INSERT OR UPDATE ON course_packages
  FOR EACH ROW
  EXECUTE FUNCTION fn_enforce_wip_cap_on_building();
