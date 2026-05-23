
-- 1a Audit-Contracts
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('bronze_drain_wave', ARRAY['wave_id','package_id','repair_vector','enqueue_source','idempotency_key'], 'p2_bronze_drain_canary'),
  ('bronze_drain_wave_summary', ARRAY['wave_id','total_candidates','dispatched','skipped','skip_reasons'], 'p2_bronze_drain_canary')
ON CONFLICT (action_type) DO UPDATE
  SET required_keys = EXCLUDED.required_keys,
      owner_module = EXCLUDED.owner_module,
      updated_at = now();

-- 1b SSOT-View: Kandidaten oldest-first mit Eligibility-Flag
CREATE OR REPLACE VIEW public.v_bronze_drain_candidates AS
WITH bronze_pkgs AS (
  SELECT
    cp.id AS package_id,
    cp.title,
    cp.priority,
    cp.curriculum_id,
    cp.feature_flags,
    COALESCE(
      (cp.feature_flags->'bronze'->>'set_at')::timestamptz,
      (cp.feature_flags->'bronze'->>'locked_at')::timestamptz,
      cp.updated_at
    ) AS oldest_signal_at,
    COALESCE((cp.feature_flags->'bronze'->>'score')::numeric,
             (cp.feature_flags->'bronze'->>'last_score')::numeric) AS bronze_score,
    COALESCE((cp.feature_flags->'bronze'->>'repair_attempts')::int, 0) AS repair_attempts,
    (cp.feature_flags->'bronze'->>'repair_active')::boolean AS repair_active,
    COALESCE(cp.feature_flags->'bronze'->>'final_state','') AS final_state
  FROM public.course_packages cp
  WHERE cp.status = 'building'
    AND (cp.feature_flags->'bronze'->>'requires_review')::boolean = true
    AND COALESCE(cp.feature_flags->'bronze'->>'manual_bypass','false')::boolean = false
    AND NOT (cp.feature_flags ? 'admin_force_building_at')
    AND COALESCE((cp.feature_flags->'bronze_quarantine'->>'active')::boolean, false) = false
),
active_jobs AS (
  SELECT
    bp.package_id,
    EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.package_id = bp.package_id
        AND jq.status IN ('pending','processing')
        AND jq.job_type = 'package_elite_harden'
        AND COALESCE(jq.meta->>'bronze_repair','') = 'true'
    ) AS has_active_repair,
    EXISTS (
      SELECT 1 FROM public.job_queue jq
      WHERE jq.package_id = bp.package_id
        AND jq.status = 'processing'
    ) AS has_processing_job
  FROM bronze_pkgs bp
)
SELECT
  bp.package_id,
  bp.title,
  bp.priority,
  bp.curriculum_id,
  bp.bronze_score,
  bp.repair_attempts,
  bp.repair_active,
  bp.final_state,
  bp.oldest_signal_at,
  aj.has_active_repair,
  aj.has_processing_job,
  CASE
    WHEN bp.curriculum_id IS NULL                         THEN 'MISSING_CURRICULUM_ID'
    WHEN bp.repair_attempts >= 1 AND bp.final_state='requires_review' THEN 'BRONZE_TERMINAL_REVIEW'
    WHEN aj.has_active_repair                              THEN 'REPAIR_ALREADY_ACTIVE'
    WHEN aj.has_processing_job                             THEN 'PROCESSING_JOB_ON_PACKAGE'
    ELSE NULL
  END AS skip_reason,
  CASE
    WHEN bp.curriculum_id IS NULL                         THEN false
    WHEN bp.repair_attempts >= 1 AND bp.final_state='requires_review' THEN false
    WHEN aj.has_active_repair                              THEN false
    WHEN aj.has_processing_job                             THEN false
    ELSE true
  END AS eligible
FROM bronze_pkgs bp
JOIN active_jobs aj USING (package_id)
ORDER BY bp.oldest_signal_at ASC NULLS LAST;

REVOKE ALL ON public.v_bronze_drain_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_bronze_drain_candidates TO service_role;

-- 1c Dispatch-RPC
CREATE OR REPLACE FUNCTION public.admin_bronze_drain_canary_dispatch(
  p_batch_size int DEFAULT 5,
  p_wave_id uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_admin boolean;
  v_total int := 0;
  v_dispatched int := 0;
  v_skipped int := 0;
  v_details jsonb := '[]'::jsonb;
  v_skip_reasons jsonb := '{}'::jsonb;
  r record;
  v_res jsonb;
  v_idem text;
  v_status text;
  v_repair_vector jsonb;
BEGIN
  v_admin := has_role(auth.uid(),'admin'::app_role);
  IF NOT v_admin AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: admin role required';
  END IF;

  IF p_batch_size < 1 OR p_batch_size > 20 THEN
    RAISE EXCEPTION 'BATCH_SIZE_OUT_OF_RANGE: 1..20 (got %)', p_batch_size;
  END IF;

  SELECT count(*) INTO v_total FROM public.v_bronze_drain_candidates WHERE eligible = true;

  FOR r IN
    SELECT * FROM public.v_bronze_drain_candidates
    WHERE eligible = true
    ORDER BY oldest_signal_at ASC NULLS LAST
    LIMIT p_batch_size
  LOOP
    BEGIN
      v_res := public.admin_bronze_targeted_repair_dispatch(r.package_id);
    EXCEPTION WHEN OTHERS THEN
      v_res := jsonb_build_object('error', SQLERRM, 'skipped', true, 'reason','RPC_EXCEPTION');
    END;

    v_idem := COALESCE(v_res->>'idempotency_key', 'bronze_repair:v3:'||r.package_id::text);
    v_repair_vector := COALESCE(v_res->'repair_vector','{}'::jsonb);

    IF (v_res->>'skipped')::boolean = true OR v_res ? 'error' THEN
      v_status := 'skipped';
      v_skipped := v_skipped + 1;
      v_skip_reasons := jsonb_set(
        v_skip_reasons,
        ARRAY[COALESCE(v_res->>'reason','UNKNOWN')],
        to_jsonb(COALESCE((v_skip_reasons->>COALESCE(v_res->>'reason','UNKNOWN'))::int,0)+1)
      );
    ELSE
      v_status := 'success';
      v_dispatched := v_dispatched + 1;
    END IF;

    PERFORM public.fn_emit_audit(
      'bronze_drain_wave',
      'package',
      r.package_id::text,
      v_status,
      jsonb_build_object(
        'wave_id', p_wave_id,
        'package_id', r.package_id,
        'repair_vector', v_repair_vector,
        'enqueue_source', 'bronze_drain_canary',
        'idempotency_key', v_idem,
        'rpc_result', v_res,
        'oldest_signal_at', r.oldest_signal_at
      ),
      'manual'
    );

    v_details := v_details || jsonb_build_array(jsonb_build_object(
      'package_id', r.package_id,
      'title', r.title,
      'status', v_status,
      'reason', v_res->>'reason',
      'idempotency_key', v_idem
    ));
  END LOOP;

  PERFORM public.fn_emit_audit(
    'bronze_drain_wave_summary',
    'system',
    p_wave_id::text,
    'success',
    jsonb_build_object(
      'wave_id', p_wave_id,
      'total_candidates', v_total,
      'dispatched', v_dispatched,
      'skipped', v_skipped,
      'skip_reasons', v_skip_reasons
    ),
    'manual'
  );

  RETURN jsonb_build_object(
    'wave_id', p_wave_id,
    'total_candidates', v_total,
    'dispatched', v_dispatched,
    'skipped', v_skipped,
    'skip_reasons', v_skip_reasons,
    'details', v_details
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_bronze_drain_canary_dispatch(int, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bronze_drain_canary_dispatch(int, uuid) TO authenticated, service_role;

-- 1d Wave-Status-View
CREATE OR REPLACE VIEW public.v_bronze_drain_wave_status AS
WITH waves AS (
  SELECT
    (metadata->>'wave_id')::uuid AS wave_id,
    min(created_at) AS started_at,
    max(created_at) AS last_event_at,
    count(*) FILTER (WHERE result_status = 'success') AS dispatched,
    count(*) FILTER (WHERE result_status = 'skipped') AS skipped,
    jsonb_agg(DISTINCT (metadata->>'package_id')::uuid)
      FILTER (WHERE result_status = 'success') AS dispatched_pkgs
  FROM public.auto_heal_log
  WHERE action_type = 'bronze_drain_wave'
    AND created_at > now() - interval '14 days'
    AND metadata ? 'wave_id'
  GROUP BY (metadata->>'wave_id')::uuid
),
job_metrics AS (
  SELECT
    w.wave_id,
    count(jq.id) FILTER (WHERE jq.status = 'completed') AS completed,
    count(jq.id) FILTER (WHERE jq.status = 'failed')    AS failed,
    avg(EXTRACT(EPOCH FROM (jq.completed_at - jq.started_at)))
      FILTER (WHERE jq.status = 'completed' AND jq.completed_at IS NOT NULL AND jq.started_at IS NOT NULL) AS avg_runtime_s
  FROM waves w
  LEFT JOIN public.job_queue jq
    ON jq.job_type = 'package_elite_harden'
   AND COALESCE(jq.meta->>'bronze_repair','') = 'true'
   AND jq.created_at >= w.started_at
   AND jq.created_at <= w.last_event_at + interval '6 hours'
   AND w.dispatched_pkgs ? jq.package_id::text
  GROUP BY w.wave_id
),
tail_released AS (
  SELECT
    w.wave_id,
    count(DISTINCT ps.package_id) AS tail_released
  FROM waves w
  LEFT JOIN public.package_steps ps
    ON ps.step_key IN ('package_auto_publish','package_quality_council','run_integrity_check')
   AND ps.status = 'done'
   AND ps.finished_at >= w.started_at
   AND w.dispatched_pkgs ? ps.package_id::text
  GROUP BY w.wave_id
),
remaining AS (
  SELECT count(*) AS bronze_remaining FROM public.v_bronze_drain_candidates WHERE eligible = true
)
SELECT
  w.wave_id,
  w.started_at,
  w.last_event_at,
  w.dispatched,
  w.skipped,
  COALESCE(jm.completed, 0) AS completed,
  COALESCE(jm.failed, 0)    AS failed,
  COALESCE(tr.tail_released, 0) AS tail_released,
  jm.avg_runtime_s,
  (SELECT bronze_remaining FROM remaining) AS bronze_remaining
FROM waves w
LEFT JOIN job_metrics jm USING (wave_id)
LEFT JOIN tail_released tr USING (wave_id)
ORDER BY w.started_at DESC;

REVOKE ALL ON public.v_bronze_drain_wave_status FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_bronze_drain_wave_status TO service_role;

-- 1e Cockpit-RPC
CREATE OR REPLACE FUNCTION public.admin_get_bronze_drain_waves(p_limit int DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_admin boolean;
  v_remaining int;
  v_candidates_eligible int;
  v_waves jsonb;
BEGIN
  v_admin := has_role(auth.uid(),'admin'::app_role);
  IF NOT v_admin AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: admin role required';
  END IF;

  SELECT count(*) FILTER (WHERE eligible) INTO v_candidates_eligible
  FROM public.v_bronze_drain_candidates;

  SELECT count(*) INTO v_remaining FROM public.v_bronze_drain_candidates;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_waves
  FROM (
    SELECT * FROM public.v_bronze_drain_wave_status
    LIMIT GREATEST(1, LEAST(p_limit, 50))
  ) t;

  RETURN jsonb_build_object(
    'bronze_remaining_total', v_remaining,
    'bronze_eligible', v_candidates_eligible,
    'waves', v_waves,
    'computed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_bronze_drain_waves(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_bronze_drain_waves(int) TO authenticated, service_role;
