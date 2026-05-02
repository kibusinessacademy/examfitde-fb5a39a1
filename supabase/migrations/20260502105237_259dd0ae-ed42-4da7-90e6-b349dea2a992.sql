CREATE OR REPLACE FUNCTION public.fn_heal_control_lane_dag_drift()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lane_active_processing int;
  v_lane_stale_processing  int;
  v_failed_qc_healed   int := 0;
  v_failed_qc_error    text := NULL;
  v_pending_enq_pkgs   uuid[];
  v_pending_enq_chunks jsonb := '[]'::jsonb;
  v_pending_enq_ok     int := 0;
  v_pending_enq_failed int := 0;
  v_chunk uuid[];
  v_chunk_result jsonb;
  v_queued_qc          int := 0;
  v_nudged_pkgs        int := 0;
  v_pkg uuid;
  v_run_id uuid := gen_random_uuid();
  v_i int;
  v_total int;
BEGIN
  SELECT 
    COUNT(*) FILTER (WHERE updated_at > now() - interval '10 minutes'),
    COUNT(*) FILTER (WHERE updated_at <= now() - interval '10 minutes')
  INTO v_lane_active_processing, v_lane_stale_processing
  FROM public.job_queue WHERE lane='control' AND status='processing';

  IF v_lane_active_processing > 0 THEN
    INSERT INTO public.auto_heal_log(action_type,result_status,target_type,metadata)
    VALUES('control_lane_drift_skipped','skipped','system',
           jsonb_build_object('reason','lane_actively_processing',
             'active_processing_jobs',v_lane_active_processing,
             'stale_processing_jobs',v_lane_stale_processing,'run_id',v_run_id));
    RETURN jsonb_build_object('skipped',true,'reason','lane_actively_processing',
      'active_processing',v_lane_active_processing,'stale_processing',v_lane_stale_processing);
  END IF;

  IF v_lane_stale_processing > 0 THEN
    INSERT INTO public.auto_heal_log(action_type,result_status,target_type,metadata)
    VALUES('control_lane_drift_stale_processing_detected','warning','system',
           jsonb_build_object('stale_processing_jobs',v_lane_stale_processing,
             'note','heal_proceeds_despite_stale_jobs','run_id',v_run_id));
  END IF;

  -- Sub-Heal 1: Failed QCs (TABLE-Return)
  BEGIN
    SELECT COUNT(*) INTO v_failed_qc_healed FROM public.admin_heal_failed_quality_councils();
  EXCEPTION WHEN OTHERS THEN
    v_failed_qc_healed := -1;
    v_failed_qc_error  := SQLERRM;
  END;

  -- Sub-Heal 2: Pending-Enqueue Drift — chunked, je 5 Pakete, isolierte Exception pro Chunk
  BEGIN
    SELECT array_agg(DISTINCT package_id) INTO v_pending_enq_pkgs
    FROM public.package_steps WHERE status::text = 'pending_enqueue';

    v_total := COALESCE(array_length(v_pending_enq_pkgs,1), 0);

    IF v_total > 0 THEN
      PERFORM set_config('request.jwt.claim.role', 'service_role', true);

      v_i := 1;
      WHILE v_i <= v_total LOOP
        v_chunk := v_pending_enq_pkgs[v_i : LEAST(v_i + 4, v_total)];
        BEGIN
          v_chunk_result := public.admin_heal_pending_enqueue_drift(
            p_package_ids := v_chunk,
            p_reason      := 'control_lane_drift_watchdog',
            p_dry_run     := false
          );
          v_pending_enq_ok := v_pending_enq_ok + array_length(v_chunk,1);
          v_pending_enq_chunks := v_pending_enq_chunks || jsonb_build_object(
            'chunk_size', array_length(v_chunk,1),
            'ok', true,
            'result', v_chunk_result
          );
        EXCEPTION WHEN OTHERS THEN
          v_pending_enq_failed := v_pending_enq_failed + array_length(v_chunk,1);
          v_pending_enq_chunks := v_pending_enq_chunks || jsonb_build_object(
            'chunk_size', array_length(v_chunk,1),
            'ok', false,
            'error', SQLERRM,
            'pkg_ids', to_jsonb(v_chunk)
          );
        END;
        v_i := v_i + 5;
      END LOOP;
    END IF;
  END;

  -- Sub-Heal 3: Queued QCs ohne Job nudgen
  FOR v_pkg IN
    SELECT DISTINCT ps.package_id FROM public.package_steps ps
    WHERE ps.step_key='quality_council' AND ps.status='queued'
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue jq
        WHERE jq.job_type='package_quality_council'
          AND (jq.payload->>'package_id')::uuid = ps.package_id
          AND jq.status IN ('pending','processing'))
    LIMIT 50
  LOOP
    BEGIN
      PERFORM public.admin_nudge_atomic_trigger(v_pkg);
      v_nudged_pkgs := v_nudged_pkgs + 1;
      v_queued_qc   := v_queued_qc + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.auto_heal_log(action_type,result_status,target_type,target_id,metadata)
      VALUES('control_lane_drift_nudge_failed','failed','course_packages', v_pkg::text,
             jsonb_build_object('package_id', v_pkg, 'error', SQLERRM, 'run_id', v_run_id));
    END;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type,result_status,target_type,metadata)
  VALUES('control_lane_drift_heal',
    CASE WHEN v_failed_qc_error IS NOT NULL OR v_pending_enq_failed > 0
         THEN 'partial' ELSE 'success' END,
    'system',
    jsonb_build_object('run_id',v_run_id,'pkgs_nudged',v_nudged_pkgs,
      'queued_qc_nudged',v_queued_qc,'stale_processing_seen',v_lane_stale_processing,
      'sub_reports', jsonb_build_object(
        'failed_quality_councils', jsonb_build_object('healed',v_failed_qc_healed,'error',v_failed_qc_error),
        'pending_enqueue_drift', jsonb_build_object(
          'input_pkgs', COALESCE(array_length(v_pending_enq_pkgs,1),0),
          'pkgs_processed_ok', v_pending_enq_ok,
          'pkgs_failed', v_pending_enq_failed,
          'chunks', v_pending_enq_chunks))));

  RETURN jsonb_build_object('skipped',false,'run_id',v_run_id,
    'pkgs_nudged',v_nudged_pkgs,'queued_qc_nudged',v_queued_qc,
    'stale_processing_seen',v_lane_stale_processing,
    'sub_reports', jsonb_build_object(
      'failed_quality_councils', jsonb_build_object('healed',v_failed_qc_healed,'error',v_failed_qc_error),
      'pending_enqueue_drift', jsonb_build_object(
        'input_pkgs', COALESCE(array_length(v_pending_enq_pkgs,1),0),
        'pkgs_processed_ok', v_pending_enq_ok,
        'pkgs_failed', v_pending_enq_failed,
        'chunks', v_pending_enq_chunks)));
END;
$function$;