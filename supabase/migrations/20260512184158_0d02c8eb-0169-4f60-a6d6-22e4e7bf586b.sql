DROP FUNCTION IF EXISTS public.admin_route_quality_failures_to_repair(int, boolean, boolean);

CREATE OR REPLACE FUNCTION public.admin_route_quality_failures_to_repair(
  p_limit int DEFAULT 10,
  p_dry_run boolean DEFAULT true,
  p_cancel_integrity_loop boolean DEFAULT true
)
RETURNS TABLE(
  o_package_id uuid,
  o_repair_class text,
  o_job_type_enqueued text,
  o_enqueue_status text,
  o_cancelled_integrity_jobs int,
  o_skip_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  v_admin boolean;
  v_job_type text;
  v_idem text;
  v_existing_id uuid;
  v_inserted_id uuid;
  v_now timestamptz := now();
  v_hour text := to_char(now(), 'YYYYMMDDHH24');
  v_cancelled int;
  v_curriculum_id uuid;
BEGIN
  v_admin := public.has_role(auth.uid(), 'admin')
          OR current_user IN ('postgres','service_role','supabase_admin');
  IF NOT v_admin THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

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

    v_idem := 'quality_route:' || rec.package_id::text || ':' || rec.repair_class || ':' || v_hour;

    SELECT jq.id INTO v_existing_id
    FROM job_queue jq
    WHERE jq.package_id = rec.package_id
      AND jq.job_type = v_job_type
      AND jq.idempotency_key = v_idem
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      o_package_id := rec.package_id; o_repair_class := rec.repair_class;
      o_job_type_enqueued := v_job_type; o_enqueue_status := 'idempotent_skip';
      o_cancelled_integrity_jobs := 0; o_skip_reason := 'already_enqueued_this_hour';
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
      RETURN NEXT; CONTINUE;
    END IF;

    IF p_dry_run THEN
      o_package_id := rec.package_id; o_repair_class := rec.repair_class;
      o_job_type_enqueued := v_job_type; o_enqueue_status := 'dry_run_would_enqueue';
      o_cancelled_integrity_jobs := 0; o_skip_reason := NULL;
      RETURN NEXT;

      INSERT INTO auto_heal_log (action_type, target_id, target_type, result_status, result_detail, metadata)
      VALUES ('quality_route_dryrun', rec.package_id, 'course_package', 'ok', rec.repair_class,
              jsonb_build_object('job_type', v_job_type, 'idempotency_key', v_idem,
                                 'reasons', rec.hard_fail_reasons, 'jobs_24h', rec.jobs_24h));
      CONTINUE;
    END IF;

    INSERT INTO job_queue (package_id, job_type, status, priority, payload, meta, idempotency_key)
    VALUES (
      rec.package_id, v_job_type, 'pending', 60,
      jsonb_build_object('package_id', rec.package_id, 'curriculum_id', v_curriculum_id,
                         'repair_class', rec.repair_class, 'reasons', rec.hard_fail_reasons,
                         'enqueue_source', 'admin_route_quality_failures_to_repair'),
      jsonb_build_object('_origin', 'quality_route_v1', 'idempotency_key', v_idem,
                         'routed_by','admin_route_quality_failures_to_repair'),
      v_idem
    )
    RETURNING id INTO v_inserted_id;

    IF p_cancel_integrity_loop THEN
      WITH upd AS (
        UPDATE job_queue jq
           SET status = 'cancelled', completed_at = v_now,
               error = COALESCE(jq.error,'') || ' [cancelled by quality_route_v1: routed to ' || rec.repair_class || ']',
               meta = COALESCE(jq.meta,'{}'::jsonb) || jsonb_build_object(
                 '_cancelled_by','admin_route_quality_failures_to_repair',
                 '_cancelled_reason', rec.repair_class,
                 '_cancelled_at', v_now)
         WHERE jq.package_id = rec.package_id
           AND jq.job_type = 'package_run_integrity_check'
           AND jq.status = 'pending'
           AND COALESCE(jq.last_error_code,'') = 'QUALITY_THRESHOLD_NOT_MET'
        RETURNING 1
      )
      SELECT count(*) INTO v_cancelled FROM upd;
    END IF;

    INSERT INTO auto_heal_log (action_type, target_id, target_type, result_status, result_detail, metadata)
    VALUES ('quality_route_enqueued', rec.package_id, 'course_package', 'ok', rec.repair_class,
            jsonb_build_object('job_type', v_job_type, 'job_id', v_inserted_id,
                               'idempotency_key', v_idem,
                               'cancelled_integrity_jobs', v_cancelled,
                               'reasons', rec.hard_fail_reasons));

    o_package_id := rec.package_id; o_repair_class := rec.repair_class;
    o_job_type_enqueued := v_job_type; o_enqueue_status := 'enqueued';
    o_cancelled_integrity_jobs := v_cancelled; o_skip_reason := NULL;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_route_quality_failures_to_repair(int, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_route_quality_failures_to_repair(int, boolean, boolean) TO service_role, authenticated;

DO $$
DECLARE v_dry jsonb; v_live jsonb;
BEGIN
  SELECT jsonb_agg(to_jsonb(t)) INTO v_dry
  FROM admin_route_quality_failures_to_repair(10, true, true) t;
  INSERT INTO auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
  VALUES ('ops_quality_route_run', 'system', 'ok', 'dry_run',
          jsonb_build_object('limit', 10, 'cancel', true, 'rows', COALESCE(v_dry, '[]'::jsonb)));

  SELECT jsonb_agg(to_jsonb(t)) INTO v_live
  FROM admin_route_quality_failures_to_repair(5, false, true) t;
  INSERT INTO auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
  VALUES ('ops_quality_route_run', 'system', 'ok', 'live_run',
          jsonb_build_object('limit', 5, 'cancel', true, 'rows', COALESCE(v_live, '[]'::jsonb)));
END $$;