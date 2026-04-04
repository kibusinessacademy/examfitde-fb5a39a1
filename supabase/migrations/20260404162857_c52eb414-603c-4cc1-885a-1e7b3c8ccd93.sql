CREATE OR REPLACE FUNCTION public.reconcile_queued_steps_to_jobs(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_pkg record;
BEGIN
  SELECT cp.id, cp.curriculum_id, cp.course_id, cp.certification_id,
         cp.feature_flags, cp.status as pkg_status
  INTO v_pkg
  FROM course_packages cp
  WHERE cp.id = p_package_id;

  IF v_pkg IS NULL THEN
    RETURN jsonb_build_object('error', 'package not found');
  END IF;

  IF v_pkg.pkg_status NOT IN ('building', 'quality_gate_failed', 'blocked') THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'package not in actionable state', 'status', v_pkg.pkg_status);
  END IF;

  -- Map step_key to registered job_type (package_ prefix)
  INSERT INTO job_queue (job_type, payload, status, created_at, updated_at)
  SELECT
    'package_' || ps.step_key,
    jsonb_build_object(
      'package_id', ps.package_id::text,
      'curriculum_id', v_pkg.curriculum_id::text,
      'course_id', v_pkg.course_id::text,
      'certification_id', v_pkg.certification_id::text,
      'feature_flags', COALESCE(v_pkg.feature_flags, '{}'::jsonb),
      'mode', 'factory',
      'reconciled', true,
      'reconciled_at', now()::text
    ),
    'pending',
    now(),
    now()
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.status = 'queued'
    -- Only reconcile steps whose job_type is registered
    AND EXISTS (
      SELECT 1 FROM ops_job_type_registry r
      WHERE r.job_type = 'package_' || ps.step_key
    )
    AND NOT EXISTS (
      SELECT 1
      FROM job_queue jq
      WHERE jq.payload->>'package_id' = ps.package_id::text
        AND jq.job_type = 'package_' || ps.step_key
        AND jq.status IN ('pending','queued','processing')
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('reconciled_jobs', v_count, 'package_id', p_package_id::text);
END;
$$;