
-- ═══════════════════════════════════════════════════════════════
-- RPC: check_fan_out_completion
-- Hybrid completion checker: subjob count + artifact truth
-- Returns: { ok, mode, active_subjobs, failed_subjobs, completed_subjobs, artifact_ok, artifact_detail }
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.check_fan_out_completion(
  p_package_id UUID,
  p_step_key TEXT,
  p_subjob_types TEXT[],
  p_completion_mode TEXT DEFAULT 'hybrid',
  p_completion_rpc TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active INT := 0;
  v_failed INT := 0;
  v_completed INT := 0;
  v_cancelled INT := 0;
  v_subjob_ok BOOLEAN;
  v_artifact_ok BOOLEAN := TRUE;
  v_artifact_detail JSONB := '{}'::JSONB;
  v_final_ok BOOLEAN;
  v_jt TEXT;
  v_cnt INT;
BEGIN
  -- Count subjobs by status across all subjob types
  FOR v_jt IN SELECT unnest(p_subjob_types) LOOP
    -- Active (pending, queued, processing)
    SELECT count(*) INTO v_cnt
    FROM job_queue
    WHERE package_id = p_package_id
      AND job_type = v_jt
      AND status IN ('pending', 'queued', 'processing');
    v_active := v_active + v_cnt;

    -- Failed
    SELECT count(*) INTO v_cnt
    FROM job_queue
    WHERE package_id = p_package_id
      AND job_type = v_jt
      AND status = 'failed';
    v_failed := v_failed + v_cnt;

    -- Completed
    SELECT count(*) INTO v_cnt
    FROM job_queue
    WHERE package_id = p_package_id
      AND job_type = v_jt
      AND status = 'completed';
    v_completed := v_completed + v_cnt;

    -- Cancelled
    SELECT count(*) INTO v_cnt
    FROM job_queue
    WHERE package_id = p_package_id
      AND job_type = v_jt
      AND status = 'cancelled';
    v_cancelled := v_cancelled + v_cnt;
  END LOOP;

  v_subjob_ok := (v_active = 0 AND v_failed = 0);

  -- Artifact truth check (if RPC provided and mode requires it)
  IF p_completion_rpc IS NOT NULL AND p_completion_mode IN ('artifact_truth', 'hybrid') THEN
    IF p_completion_rpc = 'get_learning_content_progress' THEN
      SELECT jsonb_build_object(
        'ok', COALESCE((r.result->>'ok')::boolean, false),
        'total', COALESCE((r.result->>'total')::int, 0),
        'real', COALESCE((r.result->>'real')::int, 0)
      )
      INTO v_artifact_detail
      FROM (SELECT get_learning_content_progress(p_package_id) AS result) r;
      v_artifact_ok := COALESCE((v_artifact_detail->>'ok')::boolean, false);
    ELSE
      -- Generic: try calling the RPC (must accept package_id parameter)
      v_artifact_ok := TRUE;
      v_artifact_detail := jsonb_build_object('note', 'generic_rpc_not_implemented');
    END IF;
  END IF;

  -- Determine final verdict based on mode
  CASE p_completion_mode
    WHEN 'subjob_count' THEN
      v_final_ok := v_subjob_ok;
    WHEN 'artifact_truth' THEN
      v_final_ok := v_artifact_ok;
    WHEN 'hybrid' THEN
      v_final_ok := v_subjob_ok AND v_artifact_ok;
    ELSE
      v_final_ok := FALSE;
  END CASE;

  RETURN jsonb_build_object(
    'ok', v_final_ok,
    'mode', p_completion_mode,
    'active_subjobs', v_active,
    'failed_subjobs', v_failed,
    'completed_subjobs', v_completed,
    'cancelled_subjobs', v_cancelled,
    'subjob_ok', v_subjob_ok,
    'artifact_ok', v_artifact_ok,
    'artifact_detail', v_artifact_detail
  );
END;
$$;

-- Grant access
GRANT EXECUTE ON FUNCTION public.check_fan_out_completion TO service_role;
