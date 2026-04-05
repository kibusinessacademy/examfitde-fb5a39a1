
CREATE OR REPLACE FUNCTION public.admin_force_depublish_and_rebuild(p_package_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Disable all relevant guards temporarily
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_published_immutable;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_building_published_drift;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_build_progress_drift;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_integrity_passed_drift;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_council_approved_drift;
  ALTER TABLE package_steps DISABLE TRIGGER trg_guard_step_done_regression;
  
  -- Full depublish + rebuild
  UPDATE course_packages
  SET status = 'building',
      is_published = false,
      published_at = NULL,
      integrity_passed = false,
      updated_at = now()
  WHERE id = p_package_id;
  
  -- Reset remaining done steps that need regression
  UPDATE package_steps
  SET status = 'queued',
      started_at = NULL,
      finished_at = NULL,
      last_error = NULL,
      attempts = 0,
      meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{reset_reason}', '"admin_force_depublish_rebuild"')
  WHERE package_id = p_package_id
    AND status = 'done'
    AND step_key IN ('quality_council');
  
  -- Re-enable all guards
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_published_immutable;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_building_published_drift;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_build_progress_drift;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_integrity_passed_drift;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_council_approved_drift;
  ALTER TABLE package_steps ENABLE TRIGGER trg_guard_step_done_regression;
END;
$$;
