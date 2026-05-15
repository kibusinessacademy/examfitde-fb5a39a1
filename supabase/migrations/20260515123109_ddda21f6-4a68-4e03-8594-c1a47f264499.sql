-- Fix B (Edge layer via RPC boundary): gate 3 RPCs called by production-guardian + cron + manual paths

-- A) reconcile_queued_steps_to_jobs — exclude parked steps in WHERE + audit
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
  v_parked_keys text[];
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

  -- Bronze-Pre-Filter (unchanged)
  IF public.fn_is_bronze_locked(p_package_id) THEN
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

  -- Park-Gate (Fix B): collect parked step_keys for audit, then exclude in INSERT
  SELECT array_agg(ps.step_key)
  INTO v_parked_keys
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.status = 'queued'
    AND public.fn_is_step_parked(p_package_id, ps.step_key);

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
    now(), now()
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.status = 'queued'
    AND v_pkg.curriculum_id IS NOT NULL
    AND NOT public.fn_is_step_parked(ps.package_id, ps.step_key)  -- Park-Gate
    AND EXISTS (
      SELECT 1 FROM ops_job_type_registry r
      WHERE r.job_type = 'package_' || ps.step_key
    )
    AND NOT EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = ps.package_id
        AND jq.job_type = 'package_' || ps.step_key
        AND jq.status IN ('pending','queued','processing')
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Audit park-skips (1h cooldown)
  IF v_parked_keys IS NOT NULL AND array_length(v_parked_keys, 1) > 0 THEN
    SELECT MAX(created_at) INTO v_last_skip
      FROM auto_heal_log
     WHERE action_type = 'requeue_skipped_park'
       AND trigger_source = 'reconcile_queued_steps_to_jobs'
       AND target_id = p_package_id::text
       AND created_at > now() - interval '1 hour';

    IF v_last_skip IS NULL THEN
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id,
                                result_status, result_detail, metadata)
      VALUES ('requeue_skipped_park',
              'reconcile_queued_steps_to_jobs', 'course_package', p_package_id::text,
              'skipped',
              format('Reconciler skipped %s parked step(s)', array_length(v_parked_keys,1)),
              jsonb_build_object(
                'package_id', p_package_id,
                'step_keys', to_jsonb(v_parked_keys),
                'job_types', to_jsonb((SELECT array_agg('package_'||k) FROM unnest(v_parked_keys) k))
              ));
    END IF;
  END IF;

  IF v_count = 0 AND v_pkg.curriculum_id IS NULL THEN
    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id,
                              result_status, result_detail, metadata)
    VALUES ('reconcile_blocked_missing_curriculum',
            'reconcile_queued_steps_to_jobs', 'package', p_package_id::text,
            'rejected', 'Cannot reconcile: package missing curriculum_id',
            jsonb_build_object('package_id', p_package_id));
  END IF;

  RETURN jsonb_build_object(
    'reconciled_jobs', v_count,
    'package_id', p_package_id::text,
    'parked_skipped', COALESCE(array_length(v_parked_keys, 1), 0)
  );
END;
$function$;


-- B) reset_failed_jobs_for_package — gate by step park
CREATE OR REPLACE FUNCTION public.reset_failed_jobs_for_package(p_package_id uuid, p_job_types text[] DEFAULT NULL::text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated int;
  v_parked_jobs text[];
BEGIN
  -- Collect job_types whose step is parked (for audit)
  SELECT array_agg(DISTINCT jq.job_type)
  INTO v_parked_jobs
  FROM job_queue jq
  WHERE jq.status = 'failed'
    AND jq.payload->>'package_id' = p_package_id::text
    AND (p_job_types IS NULL OR jq.job_type = ANY(p_job_types))
    AND jq.job_type LIKE 'package\_%' ESCAPE '\'
    AND public.fn_is_step_parked(p_package_id, regexp_replace(jq.job_type, '^package_', ''));

  UPDATE job_queue
  SET status = 'pending',
      started_at = NULL,
      last_error = NULL,
      attempts = COALESCE(attempts, 0) + 1
  WHERE status = 'failed'
    AND payload->>'package_id' = p_package_id::text
    AND (p_job_types IS NULL OR job_type = ANY(p_job_types))
    -- Park-Gate (Fix B): exclude jobs whose step is parked
    AND NOT (
      job_type LIKE 'package\_%' ESCAPE '\'
      AND public.fn_is_step_parked(p_package_id, regexp_replace(job_type, '^package_', ''))
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_parked_jobs IS NOT NULL AND array_length(v_parked_jobs, 1) > 0 THEN
    INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id,
                              result_status, result_detail, metadata)
    VALUES ('requeue_skipped_park',
            'reset_failed_jobs_for_package', 'course_package', p_package_id::text,
            'skipped',
            format('Reset skipped %s parked job_type(s)', array_length(v_parked_jobs, 1)),
            jsonb_build_object(
              'package_id', p_package_id,
              'job_types', to_jsonb(v_parked_jobs),
              'step_keys', to_jsonb((SELECT array_agg(regexp_replace(j,'^package_','')) FROM unnest(v_parked_jobs) j)),
              'requested_job_types', to_jsonb(p_job_types)
            ));
  END IF;

  RETURN v_updated;
END;
$function$;


-- C) guardian_fail_package_if_stale — pre-guard parked steps
CREATE OR REPLACE FUNCTION public.guardian_fail_package_if_stale(p_package_id uuid, p_min_age_minutes integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_age_minutes int;
  v_priority int;
  v_active_leases int;
  v_active_jobs int;
  v_active_steps int;
  v_queued_steps int;
  v_last_step_done_age_min int;
  v_higher_prio_building int;
  v_dynamic_threshold int;
  v_rows_updated int := 0;
  v_applied boolean := false;
  v_reason text := 'guarded';
  v_parked_keys text[];
  v_last_skip timestamptz;
BEGIN
  SELECT
    COALESCE(floor(extract(epoch from (now() - cp.updated_at))/60)::int, 0),
    COALESCE((cp.priority)::int, 5)
  INTO v_age_minutes, v_priority
  FROM course_packages cp
  WHERE cp.id = p_package_id;

  IF v_age_minutes IS NULL THEN
    RETURN jsonb_build_object('error', 'package not found', 'pkg_id', p_package_id);
  END IF;

  -- Park-Gate (Fix B): if ANY actionable step is parked → never fail the package
  SELECT array_agg(ps.step_key)
  INTO v_parked_keys
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.status::text IN ('queued','running','enqueued','failed')
    AND public.fn_is_step_parked(p_package_id, ps.step_key);

  IF v_parked_keys IS NOT NULL AND array_length(v_parked_keys, 1) > 0 THEN
    SELECT MAX(created_at) INTO v_last_skip
      FROM auto_heal_log
     WHERE action_type = 'requeue_skipped_park'
       AND trigger_source = 'guardian_fail_package_if_stale'
       AND target_id = p_package_id::text
       AND created_at > now() - interval '1 hour';

    IF v_last_skip IS NULL THEN
      INSERT INTO auto_heal_log(action_type, trigger_source, target_type, target_id,
                                result_status, result_detail, metadata)
      VALUES ('requeue_skipped_park',
              'guardian_fail_package_if_stale', 'course_package', p_package_id::text,
              'skipped', 'Guardian refused fail-package — parked actionable steps',
              jsonb_build_object(
                'package_id', p_package_id,
                'step_keys', to_jsonb(v_parked_keys),
                'age_min', v_age_minutes
              ));
    END IF;

    RETURN jsonb_build_object(
      'pkg_id', p_package_id,
      'age_min', v_age_minutes,
      'applied', false,
      'reason', 'guarded_parked_step',
      'parked_step_keys', to_jsonb(v_parked_keys)
    );
  END IF;

  SELECT count(*)::int INTO v_active_leases
  FROM package_leases pl
  WHERE pl.package_id = p_package_id AND pl.lease_until > now();

  SELECT count(*)::int INTO v_active_jobs
  FROM job_queue jq
  WHERE jq.payload->>'package_id' = p_package_id::text
    AND jq.status IN ('pending', 'processing');

  SELECT count(*)::int INTO v_active_steps
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.status IN ('running', 'enqueued');

  SELECT count(*)::int INTO v_queued_steps
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.status = 'queued';

  SELECT COALESCE(
    floor(extract(epoch from (now() - max(ps.finished_at)))/60)::int, 999
  ) INTO v_last_step_done_age_min
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.status = 'done'
    AND ps.finished_at IS NOT NULL;

  SELECT count(*)::int INTO v_higher_prio_building
  FROM course_packages cp2
  WHERE cp2.status = 'building'
    AND cp2.id <> p_package_id
    AND COALESCE(cp2.priority, 5) < v_priority;

  v_dynamic_threshold := CASE
    WHEN v_priority <= 3  THEN 30
    WHEN v_priority <= 5  THEN 60
    WHEN v_priority <= 8  THEN 120
    ELSE                       360
  END;

  IF v_higher_prio_building >= 5 THEN
    v_dynamic_threshold := v_dynamic_threshold * 2;
  ELSIF v_higher_prio_building >= 2 THEN
    v_dynamic_threshold := (v_dynamic_threshold * 3) / 2;
  END IF;

  IF p_min_age_minutes > v_dynamic_threshold THEN
    v_dynamic_threshold := p_min_age_minutes;
  END IF;

  IF v_active_leases > 0 OR v_active_jobs > 0 OR v_active_steps > 0 THEN
    v_reason := 'guarded_active_work';
  ELSIF v_last_step_done_age_min < GREATEST(v_dynamic_threshold / 2, 15) THEN
    v_reason := 'guarded_recent_step_completion';
  ELSIF v_queued_steps > 0 AND v_age_minutes < v_dynamic_threshold THEN
    v_reason := 'guarded_queued_steps_within_threshold';
  ELSIF v_age_minutes < v_dynamic_threshold THEN
    v_reason := 'guarded_within_threshold';
  ELSE
    UPDATE course_packages
    SET status = 'failed', updated_at = now()
    WHERE id = p_package_id AND status = 'building';

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    v_applied := (v_rows_updated > 0);
    v_reason := 'stale_build_priority_aware';
  END IF;

  RETURN jsonb_build_object(
    'pkg_id', p_package_id,
    'age_min', v_age_minutes,
    'priority', v_priority,
    'dynamic_threshold_min', v_dynamic_threshold,
    'active_leases', v_active_leases,
    'active_jobs', v_active_jobs,
    'active_steps', v_active_steps,
    'queued_steps', v_queued_steps,
    'last_step_done_age_min', v_last_step_done_age_min,
    'higher_prio_building', v_higher_prio_building,
    'applied', v_applied,
    'reason', v_reason
  );
END;
$function$;


-- D) Audit anchor for the Edge-layer rollout
INSERT INTO public.auto_heal_log(action_type, trigger_source, target_type, result_status, result_detail, metadata)
VALUES ('park_helper_ssot_rollout','fix_b_edge_via_rpc','system','success',
        'Park-Gates an RPC-Boundary deployed; Edge-Worker (production-guardian) bleibt unverändert',
        jsonb_build_object(
          'helper','fn_is_step_parked',
          'rpcs_gated', jsonb_build_array(
            'reconcile_queued_steps_to_jobs',
            'reset_failed_jobs_for_package',
            'guardian_fail_package_if_stale'
          ),
          'edge_callers', jsonb_build_array(
            'production-guardian:G1_progress_guard_shadow_stalled (via guardian_heal_shadow_stalled)',
            'production-guardian:guardian_stale_fail (via guardian_fail_package_if_stale)',
            'production-guardian:G4d_step_to_job_reconciliation (via reconcile_queued_steps_to_jobs)',
            'production-guardian:section4_requeue_failed (via reset_failed_jobs_for_package)'
          )
        ));