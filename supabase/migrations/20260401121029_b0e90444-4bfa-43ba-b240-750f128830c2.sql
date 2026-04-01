
-- Fix: Allow package_leases for blocked/quality_gate_failed packages
-- when the runner_id indicates auto-heal (repair jobs need leases)
CREATE OR REPLACE FUNCTION public.guard_package_leases_building_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.course_packages WHERE id = NEW.package_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'OPS_GUARD:PACKAGE_LEASES_NOT_FOUND: package_id=% not in course_packages', NEW.package_id;
  END IF;
  -- Allow building packages (normal case)
  IF v_status = 'building' THEN
    RETURN NEW;
  END IF;
  -- Allow blocked/quality_gate_failed packages for auto-heal and repair leases
  IF v_status IN ('blocked', 'quality_gate_failed') 
     AND (NEW.runner_id LIKE 'auto-heal-%' OR NEW.runner_id LIKE 'repair-%') THEN
    RETURN NEW;
  END IF;
  -- Reject all others
  RAISE EXCEPTION 'OPS_GUARD:PACKAGE_LEASES_NON_BUILDING: package_id=% status=%', NEW.package_id, v_status;
END; $function$;
