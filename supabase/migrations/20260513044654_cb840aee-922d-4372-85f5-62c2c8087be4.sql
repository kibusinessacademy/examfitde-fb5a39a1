CREATE OR REPLACE FUNCTION public.admin_route_quality_failures_to_repair(p_limit integer DEFAULT 10, p_dry_run boolean DEFAULT true, p_cancel_integrity_loop boolean DEFAULT true)
 RETURNS TABLE(o_package_id uuid, o_repair_class text, o_job_type_enqueued text, o_enqueue_status text, o_cancelled_integrity_jobs integer, o_skip_reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rec record;
  v_admin boolean;
  v_job_type text;
  v_idem text;
  v_existing_id uuid;
  v_inserted_id uuid;
  v_now timestamptz := now();
  v_hour text := to_char(now(), 'YYYYMMDDHH24');
  v_bucket15 text;
  v_bucket text;
  v_window_min int;
  v_cooldown_until timestamptz;
  v_is_short_class boolean;
  v_cancelled int;
  v_curriculum_id uuid;
BEGIN
  v_admin := public.has_role(auth.uid(), 'admin')
          OR current_user IN ('postgres','service_role','supabase_admin');
  IF NOT v_admin THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  v_bucket15 := to_char(
    date_trunc('hour', v_now) + (floor(extract(minute from v_now)::int / 15) * interval '15 minutes'),
    'YYYYMMDDHH24MI'
  );

  FOR rec IN
    SELECT vqf.package_id, vqf.repair_class, vqf.hard_fail_reasons, vqf.jobs_24h, vqf.last_seen
    FROM public.v_quality_threshold_failures vqf
    WHERE vqf.is_routable = true
      AND vqf.repair_class <> 'MINICHECK_REPAIR'
      AND vqf.repair_class <> 'UNKNOWN'
    ORDER BY vqf.jobs_24h DESC, vqf.last_seen DESC
    LIMIT p_limit
  LOOP
    v_cancelled := 0;
    v_job_type := CASE rec.repair_class
      WHEN 'DIFFICULTY_REBALANCE_REPAIR' THEN 'package_exam_rebalance'
      WHEN 'TRAP_GAP_REPAIR'             THEN 'package_exam_rebalance'
      WHEN 'ELITE_CONTEXT_REPAIR'        THEN 'package_exam_rebalance'
      WHEN 'POOL_GAP_REPAIR'             THEN 'pool_fill_bloom_gaps'
      WHEN 'BLOOM_GAP_REPAIR'            THEN 'pool_fill_bloom_gaps'
      WHEN 'COMPETENCY_GAP_REPAIR'       THEN 'pool_fill_bloom_gaps'
      ELSE NULL
    END;

    IF v_job_type IS NULL THEN
      o_package_id := rec.package_id; o_repair_class := rec.repair_class;
      o_job_type_enqueued := NULL; o_enqueue_status := 'skipped';
      o_cancelled_integrity_jobs := 0; o_skip_reason := 'unmapped_repair_class';
      RETURN NEXT; CONTINUE;
    END IF;

    SELECT cp.curriculum_id INTO v_curriculum_id
    FROM course_packages cp WHERE cp.id = rec.package_id;

    IF v_curriculum_id IS NULL THEN
      o_package_id := rec.package_id; o_repair_class := rec.repair_class;
      o_job_type_enqueued := v_job_type; o_enqueue_status := 'skipped';
      o_cancelled_integrity_jobs := 0; o_skip_reason := 'missing_curriculum_id';
      RETURN NEXT; CONTINUE;
    END IF;

    v_is_short_class := rec.repair_class IN ('POOL_GAP_REPAIR','BLOOM_GAP_REPAIR','COMPETENCY_GAP_REPAIR');
    IF v_is_short_class THEN
      v_bucket := v_bucket15;
      v_window_min := 15;
      v_cooldown_until := date_trunc('hour', v_now) + (floor(extract(minute from v_now)::int / 15) * interval '15 minutes') + interval '15 minutes';
    ELSE
      v_bucket := v_hour;
      v_window_min := 60;
      v_cooldown_until := date_trunc('hour', v_now) + interval '1 hour';
    END IF;

    v_idem := 'quality_route:' || rec.package_id::text || ':' || rec.repair_class || ':' || v_bucket;

    SELECT jq.id INTO v_existing_id
    FROM job_queue jq
    WHERE jq.package_id = rec.package_id
      AND jq.job_type = v_job_type
      AND jq.idempotency_key = v_idem
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      o_package_id := rec.package_id; o_repair_class := rec.repair_class;
      o_job_type_enqueued := v_job_type; o_enqueue_status := 'idempotent_skip';
      o_cancelled_integrity_jobs := 0; o_skip_reason := 'already_enqueued_this_window';
      INSERT INTO auto_heal_log (action_type, target_id, target_type, result_status, result_detail, metadata)
      VALUES ('quality_route_skipped', rec.package_id, 'course_package', 'skipped', rec.repair_class,
              jsonb_build_object(
                'job_type', v_job_type,
                'idempotency_key', v_idem,
                'cooldown_reason', 'already_enqueued_this_window',
                'cooldown_source', 'admin_route_quality_failures_to_repair',
                'cooldown_until', v_cooldown_until,
                'window_minutes', v_window_min,
                'package_id', rec.package_id,
                'enqueue_source', 'quality_route_v1'
              ));
      RETURN NEXT; CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id = rec.package_id
        AND jq.job_type = v_job_type
        AND jq.status IN ('pending','processing')
    ) THEN
      o_package_id := rec.package_id; o_repair_class := rec.repair_class;
      o_job_type_enqueued := v_job_type; o_enqueue_status := 'idempotent_skip';
      o_cancelled_integrity_jobs := 0; o_skip_reason := 'active_repair_in_flight';
      INSERT INTO auto_heal_log (action_type, target_id, target_type, result_status, result_detail, metadata)
      VALUES ('quality_route_skipped', rec.package_id, 'course_package', 'skipped', rec.repair_class,
              jsonb_build_object(
                'job_type', v_job_type,
                'cooldown_reason', 'active_repair_in_flight',
                'cooldown_source', 'admin_route_quality_failures_to_repair',
                'cooldown_until', NULL,
                'window_minutes', v_window_min,
                'package_id', rec.package_id,
                'enqueue_source', 'quality_route_v1'
              ));
      RETURN NEXT; CONTINUE;
    END IF;

    IF p_dry_run THEN
      o_package_id := rec.package_id; o_repair_class := rec.repair_class;
      o_job_type_enqueued := v_job_type; o_enqueue_status := 'dry_run_would_enqueue';
      o_cancelled_integrity_jobs := 0; o_skip_reason := NULL;
      RETURN NEXT;

      INSERT INTO auto_heal_log (action_type, target_id, target_type, result_status, result_detail, metadata)
      VALUES ('quality_route_dryrun', rec.package_id, 'course_package', 'ok', rec.repair_class,
              jsonb_build_object(
                'job_type', v_job_type,
                'idempotency_key', v_idem,
                'reasons', rec.hard_fail_reasons,
                'jobs_24h', rec.jobs_24h,
                'window_minutes', v_window_min,
                'cooldown_until', v_cooldown_until,
                'cooldown_source', 'admin_route_quality_failures_to_repair',
                'enqueue_source', 'quality_route_v1'
              ));
      CONTINUE;
    END IF;

    INSERT INTO job_queue (package_id, job_type, status, priority, payload, meta, idempotency_key)
    VALUES (
      rec.package_id, v_job_type, 'pending', 60,
      jsonb_build_object('package_id', rec.package_id, 'curriculum_id', v_curriculum_id,
                         'source','admin_route_quality_failures_to_repair',
                         'enqueue_source','quality_route_v1',
                         'repair_class', rec.repair_class,
                         'window_minutes', v_window_min),
      jsonb_build_object('quality_route', true, 'repair_class', rec.repair_class,
                         'enqueue_source','quality_route_v1',
                         'window_minutes', v_window_min,
                         'cooldown_until', v_cooldown_until),
      v_idem
    )
    RETURNING id INTO v_inserted_id;

    IF p_cancel_integrity_loop THEN
      UPDATE job_queue
      SET status = 'cancelled', updated_at = now(),
          last_error = 'cancelled_by_quality_route_to_avoid_loop'
      WHERE package_id = rec.package_id
        AND job_type = 'package_run_integrity_check'
        AND status IN ('pending','processing');
      GET DIAGNOSTICS v_cancelled = ROW_COUNT;
    END IF;

    INSERT INTO auto_heal_log (action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('quality_route_enqueued', rec.package_id, 'course_package', 'ok', rec.repair_class,
            jsonb_build_object(
              'job_type', v_job_type,
              'job_id', v_inserted_id,
              'idempotency_key', v_idem,
              'cancelled_integrity_jobs', v_cancelled,
              'reasons', rec.hard_fail_reasons,
              'window_minutes', v_window_min,
              'cooldown_until', v_cooldown_until,
              'cooldown_source', 'admin_route_quality_failures_to_repair',
              'enqueue_source', 'quality_route_v1'
            ));

    o_package_id := rec.package_id; o_repair_class := rec.repair_class;
    o_job_type_enqueued := v_job_type; o_enqueue_status := 'enqueued';
    o_cancelled_integrity_jobs := v_cancelled; o_skip_reason := NULL;
    RETURN NEXT;
  END LOOP;
END;
$function$;