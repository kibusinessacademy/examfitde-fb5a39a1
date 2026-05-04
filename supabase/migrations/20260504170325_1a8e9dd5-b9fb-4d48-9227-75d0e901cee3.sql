CREATE OR REPLACE FUNCTION public.reconcile_queued_steps_to_jobs(p_package_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int := 0;
  v_pkg record;
  v_last_skip timestamptz;
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

  -- Bronze-Pre-Filter: skip blind enqueue auf bronze-locked packages
  -- (Hard-Gate-Trigger blockt zwar council/auto_publish, aber Reconciler erzeugt sonst weiter
  --  Cancel-Loops auf early-stage steps für locked packages → hier bereits stoppen)
  IF public.fn_is_bronze_locked(p_package_id) THEN
    -- Audit mit 1h Cooldown pro Paket
    SELECT MAX(created_at) INTO v_last_skip
      FROM auto_heal_log
     WHERE action_type = 'reconcile_skipped_bronze_locked'
       AND target_id = p_package_id::text
       AND created_at > now() - interval '1 hour';

    IF v_last_skip IS NULL THEN
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id,
                                result_status, result_detail, metadata)
      VALUES ('reconcile_skipped_bronze_locked',
              'reconcile_queued_steps_to_jobs', 'package', p_package_id::text,
              'skipped', 'Reconciler skipped: package bronze-locked',
              jsonb_build_object('package_id', p_package_id,
                                 'bronze', v_pkg.feature_flags->'bronze'));
    END IF;

    RETURN jsonb_build_object('skipped', true, 'reason', 'bronze_locked',
                              'package_id', p_package_id::text);
  END IF;

  -- SSOT FIX: package_id Column + step_key + enqueue_source vollständig in payload
  INSERT INTO job_queue (job_type, package_id, payload, status, meta, created_at, updated_at)
  SELECT
    'package_' || ps.step_key,
    ps.package_id,
    jsonb_build_object(
      'package_id', ps.package_id::text,
      'curriculum_id', v_pkg.curriculum_id::text,
      'course_id', v_pkg.course_id::text,
      'certification_id', v_pkg.certification_id::text,
      'step_key', ps.step_key,
      'enqueue_source', 'reconcile_queued_steps_to_jobs',
      'mode', 'factory',
      'reconciled', true,
      'reconciled_at', now()::text
    ),
    'pending',
    jsonb_build_object(
      'source', 'reconcile_queued_steps_to_jobs',
      'enqueue_source', 'reconcile_queued_steps_to_jobs',
      'step_key', ps.step_key,
      'mode', 'factory',
      'reconciled_at', now()
    ),
    now(),
    now()
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.status = 'queued'
    AND v_pkg.curriculum_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM ops_job_type_registry r
      WHERE r.job_type = 'package_' || ps.step_key
    )
    AND NOT EXISTS (
      SELECT 1
      FROM job_queue jq
      WHERE jq.package_id = ps.package_id
        AND jq.job_type = 'package_' || ps.step_key
        AND jq.status IN ('pending','queued','processing')
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 AND v_pkg.curriculum_id IS NULL THEN
    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id,
                              result_status, result_detail, metadata)
    VALUES ('reconcile_blocked_missing_curriculum',
            'reconcile_queued_steps_to_jobs', 'package', p_package_id::text,
            'rejected', 'Cannot reconcile: package missing curriculum_id',
            jsonb_build_object('package_id', p_package_id));
  END IF;

  RETURN jsonb_build_object('reconciled_jobs', v_count, 'package_id', p_package_id::text);
END;
$function$;