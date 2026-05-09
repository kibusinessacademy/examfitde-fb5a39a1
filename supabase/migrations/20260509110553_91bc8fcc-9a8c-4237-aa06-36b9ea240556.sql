-- Targeted seed for Bürsten- und Pinselmacher LF10/LF11
-- Idempotent: skip if any active auto-seed job exists for the package.

DO $$
DECLARE
  v_pkg uuid := '5d74dcbf-8ae7-4c82-b181-09e23f02dd2c';
  v_curr uuid;
  v_active boolean;
  v_job uuid;
BEGIN
  SELECT curriculum_id INTO v_curr FROM course_packages WHERE id = v_pkg;
  IF v_curr IS NULL THEN
    RAISE NOTICE 'package % not found, skip', v_pkg;
    RETURN;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM job_queue
    WHERE package_id = v_pkg
      AND job_type = 'package_auto_seed_exam_blueprints'
      AND status IN ('pending','queued','processing')
  ) INTO v_active;

  IF v_active THEN
    RAISE NOTICE 'active seed job exists for %, skip', v_pkg;
    RETURN;
  END IF;

  INSERT INTO job_queue (job_type, package_id, status, priority, payload, run_after, created_at)
  VALUES (
    'package_auto_seed_exam_blueprints',
    v_pkg,
    'pending',
    3,
    jsonb_build_object(
      '_origin',        'wave_heal_lf_coverage',
      'package_id',     v_pkg,
      'curriculum_id',  v_curr,
      'mode',           'targeted_seed',
      'target_lfs',     jsonb_build_array('LF10','LF11'),
      'target_per_lf',  15,
      'reason',         'manual_targeted_seed_lf10_lf11',
      'enqueue_source', 'admin_targeted_buersten_pinselmacher'
    ),
    now(),
    now()
  )
  RETURNING id INTO v_job;

  PERFORM public.fn_log_guardrail_event(
    'wave_heal_lf_coverage_targeted_enqueue',
    jsonb_build_object('job_id', v_job, 'package_id', v_pkg, 'target_lfs', ARRAY['LF10','LF11'])
  );
END$$;