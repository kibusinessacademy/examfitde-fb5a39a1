
CREATE OR REPLACE FUNCTION public.admin_unseal_package_for_regen(p_package_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Temporarily disable immutability and drift guards
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_published_immutable;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_building_published_drift;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_build_progress_drift;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_council_approved_drift;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_integrity_passed_drift;
  
  UPDATE course_packages 
  SET status = 'building'
  WHERE id = p_package_id;
  
  -- Re-enable all guards
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_published_immutable;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_building_published_drift;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_build_progress_drift;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_council_approved_drift;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_integrity_passed_drift;
END;
$$;
