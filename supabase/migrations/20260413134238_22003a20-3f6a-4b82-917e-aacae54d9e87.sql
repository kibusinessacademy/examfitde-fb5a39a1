
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
  IF NEW.status <> 'building' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'building' THEN
    RETURN NEW;
  END IF;

  -- Serialize all transitions to building within the transaction
  PERFORM pg_advisory_xact_lock(hashtext('course_packages_building_wip_cap'));

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
