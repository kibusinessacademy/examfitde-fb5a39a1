-- Patch E.SQL: 15-min bucket for POOL/BLOOM/COMPETENCY classes + cooldown_reason/source/until in audit
CREATE OR REPLACE FUNCTION public.admin_route_quality_failures_to_repair(
  p_limit integer DEFAULT 10,
  p_dry_run boolean DEFAULT true,
  p_cancel_integrity_loop boolean DEFAULT true
)
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

  -- 15-min bucket: align "now" down to nearest 15-min slot
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

    -- Patch E.SQL: only POOL/BLOOM/COMPETENCY get the 15-min bucket
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
                'package_id', rec.package_id
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
                'package_id', rec.package_id
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
                'cooldown_source', 'admin_route_quality_failures_to_repair'
              ));
      CONTINUE;
    END IF;

    INSERT INTO job_queue (package_id, job_type, status, priority, payload, meta, idempotency_key)
    VALUES (
      rec.package_id, v_job_type, 'pending', 60,
      jsonb_build_object('package_id', rec.package_id, 'curriculum_id', v_curriculum_id,
                         'source','admin_route_quality_failures_to_repair',
                         'repair_class', rec.repair_class,
                         'window_minutes', v_window_min),
      jsonb_build_object('quality_route', true, 'repair_class', rec.repair_class,
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
              'cooldown_source', 'admin_route_quality_failures_to_repair'
            ));

    o_package_id := rec.package_id; o_repair_class := rec.repair_class;
    o_job_type_enqueued := v_job_type; o_enqueue_status := 'enqueued';
    o_cancelled_integrity_jobs := v_cancelled; o_skip_reason := NULL;
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- Producer-cooldown trigger audit: enrich with cooldown_reason/source/until (window stays 10min)
CREATE OR REPLACE FUNCTION public.fn_guard_pool_fill_producer_cooldown()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cur uuid;
  v_recent int;
  v_until timestamptz := now() + interval '10 minutes';
BEGIN
  IF NEW.job_type <> 'pool_fill_bloom_gaps' THEN
    RETURN NEW;
  END IF;
  IF COALESCE((NEW.payload->>'producer_cooldown_override')::boolean, false) THEN
    RETURN NEW;
  END IF;
  v_cur := NULLIF(NEW.payload->>'curriculum_id','')::uuid;
  IF v_cur IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_recent
  FROM public.auto_heal_log
  WHERE action_type = 'pool_fill_bloom_gaps_recent_fill_skipped'
    AND created_at > now() - interval '10 minutes'
    AND (metadata->>'curriculum_id') = v_cur::text;

  IF v_recent > 0 THEN
    INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, result_detail, metadata)
    VALUES (
      'pool_fill_bloom_gaps_producer_cooldown_skipped',
      'job_queue',
      NEW.package_id,
      'skipped',
      'producer_cooldown_active_recent_fill_skipped_within_10min',
      jsonb_build_object(
        'curriculum_id', v_cur,
        'package_id', NEW.package_id,
        'recent_skips_observed', v_recent,
        'window_minutes', 10,
        'enqueue_source', NEW.payload->>'enqueue_source',
        'job_type', NEW.job_type,
        'cooldown_reason', 'recent_fill_skipped_observed',
        'cooldown_source', 'fn_guard_pool_fill_producer_cooldown',
        'cooldown_until', v_until
      )
    );
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- Smoke probe (audit entry that confirms migration ran)
INSERT INTO auto_heal_log(action_type, target_type, result_status, result_detail, metadata)
VALUES ('migration_applied', 'system', 'ok',
        'patch_e_15min_bucket_for_pool_bloom_competency + cooldown_reason/source/until',
        jsonb_build_object('migration', 'patch_e_quality_route_15min', 'date', now()));