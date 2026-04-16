
CREATE OR REPLACE FUNCTION public.admin_force_depublish_and_rebuild(p_package_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_published_immutable;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_building_published_drift;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_build_progress_drift;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_integrity_passed_drift;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_council_approved_drift;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_blocked_requires_reason;
  ALTER TABLE course_packages DISABLE TRIGGER trg_enforce_wip_cap;
  ALTER TABLE package_steps DISABLE TRIGGER trg_guard_step_done_regression;
  ALTER TABLE package_steps DISABLE TRIGGER trg_clear_stale_package_flags;

  BEGIN
    UPDATE course_packages
    SET status = 'building',
        is_published = false,
        published_at = NULL,
        integrity_passed = false,
        council_approved = false,
        council_approved_at = NULL,
        is_rebuild = true,
        stuck_reason = NULL,
        blocked_reason = NULL,
        updated_at = now()
    WHERE id = p_package_id;

    UPDATE package_steps
    SET status = 'queued',
        started_at = NULL,
        finished_at = NULL,
        last_error = NULL,
        attempts = 0,
        meta = jsonb_set(
          COALESCE(meta, '{}'::jsonb), 
          '{reset_reason}', 
          '"admin_force_depublish_rebuild"'
        )
    WHERE package_id = p_package_id
      AND status = 'done'
      AND step_key IN (
        'build_ai_tutor_index', 'validate_tutor_index',
        'generate_oral_exam', 'validate_oral_exam',
        'run_integrity_check', 'quality_council', 'auto_publish'
      );

  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE course_packages ENABLE TRIGGER trg_guard_published_immutable;
    ALTER TABLE course_packages ENABLE TRIGGER trg_guard_building_published_drift;
    ALTER TABLE course_packages ENABLE TRIGGER trg_guard_build_progress_drift;
    ALTER TABLE course_packages ENABLE TRIGGER trg_guard_integrity_passed_drift;
    ALTER TABLE course_packages ENABLE TRIGGER trg_guard_council_approved_drift;
    ALTER TABLE course_packages ENABLE TRIGGER trg_guard_blocked_requires_reason;
    ALTER TABLE course_packages ENABLE TRIGGER trg_enforce_wip_cap;
    ALTER TABLE package_steps ENABLE TRIGGER trg_guard_step_done_regression;
    ALTER TABLE package_steps ENABLE TRIGGER trg_clear_stale_package_flags;
    RAISE;
  END;

  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_published_immutable;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_building_published_drift;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_build_progress_drift;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_integrity_passed_drift;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_council_approved_drift;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_blocked_requires_reason;
  ALTER TABLE course_packages ENABLE TRIGGER trg_enforce_wip_cap;
  ALTER TABLE package_steps ENABLE TRIGGER trg_guard_step_done_regression;
  ALTER TABLE package_steps ENABLE TRIGGER trg_clear_stale_package_flags;
END;
$function$;
