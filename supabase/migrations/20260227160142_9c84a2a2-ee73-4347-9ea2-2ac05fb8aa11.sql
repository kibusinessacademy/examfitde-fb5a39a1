
-- HARD GUARD: package_leases darf nur für building packages existieren
-- Strict mode: RAISE EXCEPTION macht den fehlerhaften Writer sofort sichtbar in Logs

CREATE OR REPLACE FUNCTION public.guard_package_leases_building_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status
  FROM public.course_packages
  WHERE id = NEW.package_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'package_leases guard: package_id % not found in course_packages', NEW.package_id;
  END IF;

  IF v_status <> 'building' THEN
    RAISE EXCEPTION 'package_leases guard: cannot create/renew lease for non-building package % (status=%)',
      NEW.package_id, v_status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_package_leases_building_only ON public.package_leases;

CREATE TRIGGER trg_guard_package_leases_building_only
BEFORE INSERT OR UPDATE ON public.package_leases
FOR EACH ROW
EXECUTE FUNCTION public.guard_package_leases_building_only();
