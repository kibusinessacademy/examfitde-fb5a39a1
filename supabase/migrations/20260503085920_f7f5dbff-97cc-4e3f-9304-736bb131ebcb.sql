
CREATE OR REPLACE FUNCTION public.fn_alert_hard_block_anomalies()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_whitelist text[] := ARRAY[
    'admin_soft_reentry','admin_force_publish','admin_rebuild','admin_reset',
    'admin_nudge','admin_bulk_promote','admin_heal','admin_retry_failed_step',
    'admin_heal_pending_enqueue_drift','admin_demote_protected'
  ];
  v_block_count_24h int;
  v_block_count_1h  int;
  v_unknown_sources jsonb;
  v_alerts_emitted int := 0;
  v_severity text;
  v_hash text;
BEGIN
  -- Count blocks (both guards) over 24h / 1h
  SELECT COUNT(*) INTO v_block_count_24h
  FROM auto_heal_log
  WHERE action_type IN ('hard_block_building_to_queued','guard_block_building_revert')
    AND created_at > now() - interval '24 hours';

  SELECT COUNT(*) INTO v_block_count_1h
  FROM auto_heal_log
  WHERE action_type IN ('hard_block_building_to_queued','guard_block_building_revert')
    AND created_at > now() - interval '1 hour';

  -- Threshold alert
  IF v_block_count_24h > 500 THEN
    v_severity := 'critical';
  ELSIF v_block_count_24h > 50 THEN
    v_severity := 'warning';
  ELSE
    v_severity := NULL;
  END IF;

  IF v_severity IS NOT NULL THEN
    v_hash := 'hard_block_volume_' || v_severity;
    INSERT INTO ops_alert_events (alert_key, severity, summary, details, dedupe_hash)
    SELECT
      'hard_block_volume_anomaly',
      v_severity,
      format('%s building→queued block attempts in 24h (1h: %s)', v_block_count_24h, v_block_count_1h),
      jsonb_build_object(
        'count_24h', v_block_count_24h,
        'count_1h',  v_block_count_1h,
        'threshold_warning', 50,
        'threshold_critical', 500,
        'window', '24h'
      ),
      v_hash
    WHERE NOT EXISTS (
      SELECT 1 FROM ops_alert_events
      WHERE dedupe_hash = v_hash AND resolved_at IS NULL
    );
    GET DIAGNOSTICS v_alerts_emitted = ROW_COUNT;
  END IF;

  -- Unknown transition_source detection (last 1h)
  SELECT jsonb_agg(DISTINCT trigger_source)
  INTO v_unknown_sources
  FROM auto_heal_log
  WHERE action_type IN ('hard_block_building_to_queued','guard_block_building_revert')
    AND created_at > now() - interval '1 hour'
    AND trigger_source IS NOT NULL
    AND trigger_source <> ALL (v_whitelist)
    AND trigger_source <> 'unknown_trigger';

  IF v_unknown_sources IS NOT NULL AND jsonb_array_length(v_unknown_sources) > 0 THEN
    v_hash := 'hard_block_unknown_source_' || md5(v_unknown_sources::text);
    INSERT INTO ops_alert_events (alert_key, severity, summary, details, dedupe_hash)
    SELECT
      'hard_block_non_whitelist_source',
      'critical',
      format('Non-whitelisted transition_source detected: %s', v_unknown_sources::text),
      jsonb_build_object(
        'sources', v_unknown_sources,
        'whitelist', to_jsonb(v_whitelist),
        'window', '1h'
      ),
      v_hash
    WHERE NOT EXISTS (
      SELECT 1 FROM ops_alert_events
      WHERE dedupe_hash = v_hash AND resolved_at IS NULL
    );
    v_alerts_emitted := v_alerts_emitted + 1;
  END IF;

  -- Audit
  INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
  VALUES (
    'hard_block_anomaly_check',
    'system',
    gen_random_uuid(),
    CASE WHEN v_alerts_emitted > 0 THEN 'alert_emitted' ELSE 'ok' END,
    format('blocks_24h=%s blocks_1h=%s unknown_sources=%s alerts=%s',
           v_block_count_24h, v_block_count_1h,
           COALESCE(jsonb_array_length(v_unknown_sources),0), v_alerts_emitted),
    jsonb_build_object(
      'count_24h', v_block_count_24h,
      'count_1h',  v_block_count_1h,
      'unknown_sources', v_unknown_sources,
      'alerts_emitted', v_alerts_emitted
    )
  );

  RETURN jsonb_build_object(
    'count_24h', v_block_count_24h,
    'count_1h',  v_block_count_1h,
    'unknown_sources', v_unknown_sources,
    'alerts_emitted', v_alerts_emitted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_alert_hard_block_anomalies() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_alert_hard_block_anomalies() TO service_role;
