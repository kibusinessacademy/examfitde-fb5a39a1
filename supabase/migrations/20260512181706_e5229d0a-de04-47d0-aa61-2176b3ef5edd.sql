-- =========================================================
-- Quality-Threshold Routing v1
-- =========================================================

-- 1) SSOT View: QUALITY_THRESHOLD_NOT_MET in last 24h, with primary repair class
CREATE OR REPLACE VIEW public.v_quality_threshold_failures AS
WITH recent_jobs AS (
  SELECT
    jq.package_id,
    COUNT(*) FILTER (WHERE jq.status IN ('pending','queued','retry_scheduled'))::int AS waiting_jobs,
    COUNT(*) FILTER (WHERE jq.status = 'processing')::int AS processing_jobs,
    COUNT(*) AS jobs_24h,
    MAX(jq.updated_at) AS last_seen
  FROM public.job_queue jq
  WHERE jq.job_type = 'package_run_integrity_check'
    AND jq.last_error_code = 'QUALITY_THRESHOLD_NOT_MET'
    AND jq.updated_at > now() - interval '24 hours'
    AND jq.package_id IS NOT NULL
  GROUP BY jq.package_id
),
latest_report AS (
  SELECT DISTINCT ON (h.package_id)
    h.package_id,
    h.score,
    h.hard_fail_reasons,
    h.created_at AS report_at
  FROM public.integrity_check_history h
  WHERE h.created_at > now() - interval '24 hours'
  ORDER BY h.package_id, h.created_at DESC
),
joined AS (
  SELECT
    rj.package_id,
    rj.waiting_jobs,
    rj.processing_jobs,
    rj.jobs_24h,
    rj.last_seen,
    lr.score,
    COALESCE(lr.hard_fail_reasons, ARRAY[]::text[]) AS hard_fail_reasons,
    lr.report_at,
    -- Concatenate all reason text for substring-classification
    array_to_string(COALESCE(lr.hard_fail_reasons, ARRAY[]::text[]), ' | ') AS reasons_blob
  FROM recent_jobs rj
  LEFT JOIN latest_report lr USING (package_id)
),
classified AS (
  SELECT
    j.*,
    -- Detect repair-class flags
    (j.reasons_blob ILIKE '%TOO_FEW_APPROVED%')                                   AS has_pool_gap,
    (j.reasons_blob ILIKE '%MISSING_UNDERSTAND%' OR j.reasons_blob ILIKE '%BLOOM_GATE%' OR j.reasons_blob ILIKE '%BLOOM_GAP%') AS has_bloom_gap,
    (j.reasons_blob ILIKE '%TRAP_COVERAGE%' OR j.reasons_blob ILIKE '%TRAP_GAP%') AS has_trap_gap,
    (j.reasons_blob ILIKE '%HARDISH_TOO_LOW%' OR j.reasons_blob ILIKE '%EASY_TOO_HIGH%') AS has_difficulty,
    (j.reasons_blob ILIKE '%COMPETENCY_STEP_GAP%' OR j.reasons_blob ILIKE '%COMPETENCY_COVERAGE%') AS has_competency,
    (j.reasons_blob ILIKE '%ELITE_CONTEXT%')                                      AS has_elite,
    (j.reasons_blob ILIKE '%LESSON_QUALITY%' OR j.reasons_blob ILIKE '%MINICHECK%') AS has_minicheck
  FROM joined j
)
SELECT
  c.package_id,
  cp.title              AS package_title,
  cp.status             AS package_status,
  c.waiting_jobs,
  c.processing_jobs,
  c.jobs_24h,
  c.last_seen,
  c.score,
  c.hard_fail_reasons,
  c.report_at,
  CASE
    WHEN c.has_pool_gap   THEN 'POOL_GAP_REPAIR'
    WHEN c.has_bloom_gap  THEN 'BLOOM_GAP_REPAIR'
    WHEN c.has_trap_gap   THEN 'TRAP_GAP_REPAIR'
    WHEN c.has_difficulty THEN 'DIFFICULTY_REBALANCE_REPAIR'
    WHEN c.has_competency THEN 'COMPETENCY_GAP_REPAIR'
    WHEN c.has_elite      THEN 'ELITE_CONTEXT_REPAIR'
    WHEN c.has_minicheck  THEN 'MINICHECK_REPAIR'
    ELSE 'UNKNOWN'
  END AS repair_class,
  CASE
    WHEN c.has_pool_gap OR c.has_bloom_gap OR c.has_trap_gap
      OR c.has_difficulty OR c.has_competency OR c.has_elite THEN true
    ELSE false
  END AS is_routable
FROM classified c
LEFT JOIN public.course_packages cp ON cp.id = c.package_id;

-- Lock view down (admin views must not be granted to authenticated)
REVOKE ALL ON public.v_quality_threshold_failures FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_quality_threshold_failures TO service_role;

-- 2) Admin diagnose RPC
CREATE OR REPLACE FUNCTION public.admin_get_quality_threshold_failures_24h()
RETURNS TABLE (
  package_id uuid,
  package_title text,
  package_status text,
  waiting_jobs int,
  processing_jobs int,
  jobs_24h bigint,
  last_seen timestamptz,
  score int,
  hard_fail_reasons text[],
  report_at timestamptz,
  repair_class text,
  is_routable boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.package_id, v.package_title, v.package_status,
    v.waiting_jobs, v.processing_jobs, v.jobs_24h,
    v.last_seen, v.score, v.hard_fail_reasons, v.report_at,
    v.repair_class, v.is_routable
  FROM public.v_quality_threshold_failures v
  WHERE public.has_role(auth.uid(), 'admin')
  ORDER BY v.jobs_24h DESC, v.last_seen DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_get_quality_threshold_failures_24h() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_get_quality_threshold_failures_24h() TO service_role, authenticated;

-- 3) Router RPC: enqueue repair + optional cancel of waiting integrity jobs
CREATE OR REPLACE FUNCTION public.admin_route_quality_failures_to_repair(
  p_limit int DEFAULT 10,
  p_dry_run boolean DEFAULT true,
  p_cancel_integrity_loop boolean DEFAULT true
)
RETURNS TABLE (
  package_id uuid,
  repair_class text,
  routed_job_type text,
  routed_job_id uuid,
  routed_skipped_reason text,
  cancelled_integrity_jobs int,
  idempotency_key text,
  dry_run boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  v_admin boolean;
  v_target_job_type text;
  v_payload jsonb;
  v_idem text;
  v_existing_active int;
  v_existing_idem int;
  v_new_job_id uuid;
  v_cancelled int;
  v_skip text;
BEGIN
  -- Hard admin gate
  v_admin := public.has_role(auth.uid(), 'admin');
  IF NOT v_admin THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  FOR rec IN
    SELECT *
    FROM public.v_quality_threshold_failures
    WHERE is_routable = true
      AND repair_class <> 'MINICHECK_REPAIR'
      AND repair_class <> 'UNKNOWN'
    ORDER BY jobs_24h DESC, last_seen DESC
    LIMIT GREATEST(p_limit, 0)
  LOOP
    v_skip := NULL;
    v_new_job_id := NULL;
    v_cancelled := 0;

    -- Map class → job_type + payload
    CASE rec.repair_class
      WHEN 'POOL_GAP_REPAIR' THEN
        v_target_job_type := 'package_repair_exam_pool_quality';
        v_payload := jsonb_build_object('package_id', rec.package_id, 'repair_focus', 'pool');
      WHEN 'BLOOM_GAP_REPAIR' THEN
        v_target_job_type := 'pool_fill_bloom_gaps';
        v_payload := jsonb_build_object('package_id', rec.package_id, 'repair_focus', 'bloom');
      WHEN 'TRAP_GAP_REPAIR' THEN
        v_target_job_type := 'package_exam_rebalance';
        v_payload := jsonb_build_object('package_id', rec.package_id, 'repair_focus', 'trap');
      WHEN 'DIFFICULTY_REBALANCE_REPAIR' THEN
        v_target_job_type := 'package_exam_rebalance';
        v_payload := jsonb_build_object('package_id', rec.package_id, 'repair_focus', 'difficulty');
      WHEN 'COMPETENCY_GAP_REPAIR' THEN
        v_target_job_type := 'package_repair_exam_pool_competency_coverage';
        v_payload := jsonb_build_object('package_id', rec.package_id, 'repair_focus', 'competency');
      WHEN 'ELITE_CONTEXT_REPAIR' THEN
        v_target_job_type := 'package_exam_rebalance';
        v_payload := jsonb_build_object('package_id', rec.package_id, 'repair_focus', 'elite');
      ELSE
        v_skip := 'unmapped_class';
    END CASE;

    v_idem := 'quality_route:' || rec.package_id::text || ':' || rec.repair_class
              || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDDHH24');

    IF v_skip IS NULL THEN
      -- Already enqueued in same hour bucket?
      SELECT COUNT(*) INTO v_existing_idem
      FROM public.job_queue
      WHERE idempotency_key = v_idem;

      -- Active repair already running?
      SELECT COUNT(*) INTO v_existing_active
      FROM public.job_queue
      WHERE package_id = rec.package_id
        AND job_type   = v_target_job_type
        AND status IN ('pending','queued','processing','retry_scheduled');

      IF v_existing_idem > 0 THEN
        v_skip := 'idempotent_hour_bucket';
      ELSIF v_existing_active > 0 THEN
        v_skip := 'active_repair_already_running';
      END IF;
    END IF;

    IF v_skip IS NULL AND NOT p_dry_run THEN
      INSERT INTO public.job_queue (
        job_type, status, payload, package_id, idempotency_key, priority,
        meta, worker_pool, lane
      ) VALUES (
        v_target_job_type,
        'pending',
        v_payload,
        rec.package_id,
        v_idem,
        100,
        jsonb_build_object(
          '_origin','quality_route_v1',
          'repair_class', rec.repair_class,
          'source_reason_codes', rec.hard_fail_reasons,
          'routed_by','admin_route_quality_failures_to_repair'
        ),
        'default',
        'core'
      )
      RETURNING id INTO v_new_job_id;

      -- Cancel waiting integrity loop jobs (never processing)
      IF p_cancel_integrity_loop THEN
        WITH cancelled AS (
          UPDATE public.job_queue
          SET status = 'cancelled',
              completed_at = now(),
              updated_at = now(),
              last_error = 'cancelled_by_quality_route_v1',
              meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
                '_cancelled_by','admin_route_quality_failures_to_repair',
                '_cancelled_for_class', rec.repair_class,
                '_cancelled_at', now()
              )
          WHERE package_id = rec.package_id
            AND job_type   = 'package_run_integrity_check'
            AND status IN ('pending','queued','retry_scheduled')
            AND last_error_code = 'QUALITY_THRESHOLD_NOT_MET'
          RETURNING 1
        )
        SELECT COUNT(*) INTO v_cancelled FROM cancelled;
      END IF;

      -- Audit
      INSERT INTO public.auto_heal_log (
        action_type, target_type, target_id, result_status, reason_code, metadata
      ) VALUES (
        'quality_route_enqueued',
        'package',
        rec.package_id,
        'success',
        rec.repair_class,
        jsonb_build_object(
          'job_type', v_target_job_type,
          'job_id', v_new_job_id,
          'idempotency_key', v_idem,
          'cancelled_integrity_jobs', v_cancelled,
          'hard_fail_reasons', rec.hard_fail_reasons,
          'score', rec.score
        )
      );
    ELSIF v_skip IS NULL AND p_dry_run THEN
      -- Dry-run audit (skipped INSERT, no cancel)
      INSERT INTO public.auto_heal_log (
        action_type, target_type, target_id, result_status, reason_code, metadata
      ) VALUES (
        'quality_route_dry_run',
        'package',
        rec.package_id,
        'noop',
        rec.repair_class,
        jsonb_build_object(
          'job_type', v_target_job_type,
          'idempotency_key', v_idem,
          'would_cancel_integrity', p_cancel_integrity_loop,
          'hard_fail_reasons', rec.hard_fail_reasons
        )
      );
    ELSE
      -- Skipped path audit
      INSERT INTO public.auto_heal_log (
        action_type, target_type, target_id, result_status, reason_code, metadata
      ) VALUES (
        'quality_route_skipped',
        'package',
        rec.package_id,
        'skipped',
        COALESCE(v_skip,'unknown_skip'),
        jsonb_build_object(
          'repair_class', rec.repair_class,
          'idempotency_key', v_idem,
          'job_type', v_target_job_type
        )
      );
    END IF;

    package_id := rec.package_id;
    repair_class := rec.repair_class;
    routed_job_type := v_target_job_type;
    routed_job_id := v_new_job_id;
    routed_skipped_reason := v_skip;
    cancelled_integrity_jobs := v_cancelled;
    idempotency_key := v_idem;
    dry_run := p_dry_run;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_route_quality_failures_to_repair(int, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_route_quality_failures_to_repair(int, boolean, boolean) TO service_role, authenticated;

NOTIFY pgrst, 'reload schema';