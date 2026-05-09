
-- =========================================================================
-- S5b — First-Heartbeat-Contract
-- =========================================================================

-- 1) RPC: workers must call this as their FIRST action after parsing job_id,
--         BEFORE any AI / heavy DB / external API call.
CREATE OR REPLACE FUNCTION public.mark_job_first_heartbeat(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_existing timestamptz;
  v_locked_at timestamptz;
BEGIN
  IF p_job_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'job_id_null');
  END IF;

  UPDATE public.job_queue
     SET last_heartbeat_at = v_now,
         meta = COALESCE(meta, '{}'::jsonb)
                || jsonb_build_object(
                     'first_heartbeat_at',
                     COALESCE(meta->>'first_heartbeat_at', v_now::text)
                   )
   WHERE id = p_job_id
     AND status = 'processing'
   RETURNING locked_at, (meta->>'first_heartbeat_at')::timestamptz
        INTO v_locked_at, v_existing;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_processing_or_missing');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'first_heartbeat_at', COALESCE(v_existing, v_now),
    'locked_at', v_locked_at,
    'lag_ms', EXTRACT(EPOCH FROM (v_now - v_locked_at))::int * 1000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_job_first_heartbeat(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_job_first_heartbeat(uuid) TO service_role;

-- 2) Compliance view: per job_type last 24h
CREATE OR REPLACE VIEW public.v_first_heartbeat_contract_compliance AS
WITH base AS (
  SELECT
    job_type,
    COALESCE(lane,'default') AS lane,
    COALESCE(worker_pool,'default') AS pool,
    locked_at,
    last_heartbeat_at,
    (meta->>'first_heartbeat_at')::timestamptz AS first_hb_at,
    status
  FROM public.job_queue
  WHERE locked_at IS NOT NULL
    AND locked_at > now() - interval '24 hours'
)
SELECT
  job_type,
  lane,
  pool,
  COUNT(*)::int AS claimed_n,
  COUNT(*) FILTER (WHERE first_hb_at IS NOT NULL)::int AS with_first_hb,
  COUNT(*) FILTER (WHERE first_hb_at IS NOT NULL
                     AND first_hb_at <= locked_at + interval '30 seconds')::int AS hb_within_30s,
  COUNT(*) FILTER (WHERE last_heartbeat_at IS NULL)::int AS phk_signature,
  COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_n,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE first_hb_at IS NOT NULL
                               AND first_hb_at <= locked_at + interval '30 seconds')
    / NULLIF(COUNT(*),0), 2
  ) AS contract_compliance_pct
FROM base
GROUP BY 1,2,3
ORDER BY claimed_n DESC;

REVOKE ALL ON public.v_first_heartbeat_contract_compliance FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_first_heartbeat_contract_compliance TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_first_heartbeat_compliance()
RETURNS SETOF public.v_first_heartbeat_contract_compliance
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.v_first_heartbeat_contract_compliance;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_first_heartbeat_compliance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_first_heartbeat_compliance() TO authenticated;

-- 3) PHK-aware adaptive burst v3 — caps the affected control-lane job_types
CREATE OR REPLACE FUNCTION public.fn_adaptive_burst_size_v3(
  p_pending int,
  p_failure_rate_15m numeric,
  p_reaper_churn_5m int,
  p_lane text,
  p_pool text,
  p_job_type text DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_size int;
  v_phk_1h int := 0;
  v_phk_sensitive boolean;
BEGIN
  v_phk_sensitive := p_job_type = ANY(ARRAY[
    'package_quality_council',
    'package_run_integrity_check',
    'package_auto_publish',
    'package_validate_tutor_index',
    'package_build_ai_tutor_index'
  ]);

  IF v_phk_sensitive THEN
    SELECT COUNT(*)::int INTO v_phk_1h
    FROM public.job_queue
    WHERE job_type = p_job_type
      AND last_error_code IN ('PRE_HEARTBEAT_KILL','PRE_HEARTBEAT_KILL_TERMINAL')
      AND updated_at > now() - interval '1 hour';

    IF v_phk_1h > 0 THEN
      RETURN 3;  -- CPU-safe small batch
    END IF;
  END IF;

  v_size := public.fn_adaptive_burst_size_v2(
    p_pending, p_failure_rate_15m, p_reaper_churn_5m, p_lane, p_pool
  );

  IF v_phk_sensitive THEN
    v_size := LEAST(v_size, 8);  -- soft cap for sensitive types
  END IF;

  RETURN v_size;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_adaptive_burst_size_v3(int, numeric, int, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_adaptive_burst_size_v3(int, numeric, int, text, text, text)
  TO service_role;

-- Smoke
DO $$
DECLARE r jsonb;
BEGIN
  r := public.mark_job_first_heartbeat(NULL);
  IF (r->>'ok')::boolean THEN RAISE EXCEPTION 'mark_job_first_heartbeat NULL must return ok=false'; END IF;

  PERFORM public.fn_adaptive_burst_size_v3(50, 0.1, 2, 'control', 'default', 'package_quality_council');
END $$;

INSERT INTO public.auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
VALUES (
  's5b_first_heartbeat_contract_deployed',
  'system',
  'ok',
  'mark_job_first_heartbeat + compliance view + burst v3 deployed',
  jsonb_build_object('phase', 'S5b', 'sensitive_types', 5)
);
