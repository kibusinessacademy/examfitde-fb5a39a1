
CREATE OR REPLACE FUNCTION public._admin_backfill_council_verdict_2026_05_04()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_a int; v_b int; v_c int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role)
     AND COALESCE(current_setting('request.jwt.claim.role',true),'') <> 'service_role' THEN
    RAISE EXCEPTION 'admin or service_role required';
  END IF;

  PERFORM set_config('session_replication_role','replica',true);

  WITH u AS (
    UPDATE public.package_steps ps
    SET meta = ps.meta
      || jsonb_build_object('ok', true)
      || jsonb_build_object('verdict', jsonb_build_object(
           'status', ps.meta->>'status',
           'score', ps.meta->>'score',
           'badge', ps.meta->>'badge',
           'source','backfill_2026_05_04_drift_wave',
           'backfilled_at', now()))
    WHERE ps.step_key='quality_council' AND ps.status='done'
      AND (ps.meta->'verdict'->>'status') IS NULL
      AND ps.meta->>'status' IN ('pass','fail')
      AND COALESCE((ps.meta->>'executed')::bool,false)=true
    RETURNING 1
  ) SELECT count(*) INTO v_a FROM u;

  WITH u AS (
    UPDATE public.package_steps ps
    SET meta = ps.meta
      || jsonb_build_object('ok', true)
      || jsonb_build_object('verdict', jsonb_build_object(
           'status','bypass',
           'reason', COALESCE(ps.meta->>'done_reason', ps.meta->>'reset_reason','admin_bypass'),
           'source','backfill_2026_05_04_drift_wave',
           'backfilled_at', now()))
    WHERE ps.step_key='quality_council' AND ps.status='done'
      AND (ps.meta->'verdict'->>'status') IS NULL
      AND (
        ps.meta ? 'emergency_bypass'
        OR ps.meta->>'done_reason' ILIKE 'admin_%'
        OR ps.meta->>'done_reason' ILIKE 'manual%'
        OR ps.meta->>'done_reason' ILIKE 'multi_heal%'
        OR ps.meta->>'done_reason' ILIKE 'p0_%'
        OR ps.meta->>'done_reason' ILIKE 'sustainable_heal%'
        OR ps.meta->>'done_reason' ILIKE 'cluster_%'
      )
    RETURNING 1
  ) SELECT count(*) INTO v_b FROM u;

  WITH u AS (
    UPDATE public.package_steps ps
    SET meta = ps.meta
      || jsonb_build_object('ok', true)
      || jsonb_build_object('verdict', jsonb_build_object(
           'status','legacy_unknown',
           'reason','pre_verdict_contract_legacy_done_step',
           'source','backfill_2026_05_04_drift_wave',
           'backfilled_at', now()))
    WHERE ps.step_key='quality_council' AND ps.status='done'
      AND (ps.meta->'verdict'->>'status') IS NULL
    RETURNING 1
  ) SELECT count(*) INTO v_c FROM u;

  PERFORM set_config('session_replication_role','origin',true);

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
  VALUES ('governance_verdict_backfill','system',NULL,'success',
          format('class_a=%s class_b=%s class_c=%s', v_a, v_b, v_c),
          jsonb_build_object('wave','drift_wave_2026_05_04','class_a',v_a,'class_b',v_b,'class_c',v_c));

  RETURN jsonb_build_object('ok',true,'class_a',v_a,'class_b',v_b,'class_c',v_c);
END $$;

REVOKE EXECUTE ON FUNCTION public._admin_backfill_council_verdict_2026_05_04() FROM PUBLIC, anon, authenticated;
