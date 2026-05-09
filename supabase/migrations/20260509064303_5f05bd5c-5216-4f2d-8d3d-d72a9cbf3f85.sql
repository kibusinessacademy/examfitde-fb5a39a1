
-- 1) Reaper hotfix — count(*), terminal threshold off-by-one, generic-exclude PHK rows, merge-friendly quarantine
CREATE OR REPLACE FUNCTION public.fn_reap_stale_processing_jobs(p_stale_minutes integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_requeued int := 0; v_failed int := 0; v_loop_killed int := 0;
  v_phk_requeued int := 0; v_phk_terminal int := 0; v_quarantined_pkgs int := 0;
  v_cutoff timestamptz; v_phk_cutoff timestamptz;
  v_max_reaps int := 2; v_max_phk int := 2;
BEGIN
  v_cutoff := now() - (p_stale_minutes || ' minutes')::interval;
  v_phk_cutoff := now() - interval '3 minutes';

  -- (PHK-A) Terminal on the 2nd PHK (count >= max_phk - 1, then becomes max_phk after increment)
  WITH phk_terminal AS (
    SELECT id, package_id, COALESCE((meta->>'pre_heartbeat_kill_count')::int, 0) AS phk_count
    FROM public.job_queue
    WHERE status = 'processing' AND last_heartbeat_at IS NULL AND locked_at IS NOT NULL
      AND locked_at < v_phk_cutoff
      AND COALESCE((meta->>'pre_heartbeat_kill_count')::int, 0) >= (v_max_phk - 1)
    FOR UPDATE SKIP LOCKED
  ),
  upd_phk_terminal AS (
    UPDATE public.job_queue jq
    SET status='failed', completed_at=now(), locked_at=NULL, locked_by=NULL,
        liveness_status='killed',
        last_error='PRE_HEARTBEAT_KILL_TERMINAL: claimed >= '||v_max_phk||' times without ever sending a heartbeat',
        last_error_code='PRE_HEARTBEAT_KILL_TERMINAL',
        meta=COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
          'pre_heartbeat_kill_terminal_at', to_jsonb(now()),
          'pre_heartbeat_kill_count', p.phk_count + 1),
        updated_at=now()
    FROM phk_terminal p WHERE jq.id = p.id
    RETURNING jq.id
  )
  SELECT count(*) INTO v_phk_terminal FROM upd_phk_terminal;

  -- (PHK-A2) Quarantine packages — merge-friendly to preserve occurrences + history
  WITH q AS (
    UPDATE public.course_packages cp
    SET feature_flags = COALESCE(cp.feature_flags,'{}'::jsonb) || jsonb_build_object(
      'pre_heartbeat_quarantine',
        COALESCE(cp.feature_flags->'pre_heartbeat_quarantine','{}'::jsonb)
        || jsonb_build_object(
          'active', true,
          'reason', 'PRE_HEARTBEAT_KILL_TERMINAL',
          'quarantined_at', to_jsonb(now()),
          'occurrences', COALESCE((cp.feature_flags->'pre_heartbeat_quarantine'->>'occurrences')::int, 0) + 1,
          'manual_bypass', false
        )),
      updated_at = now()
    WHERE cp.id IN (
      SELECT DISTINCT package_id FROM public.job_queue
      WHERE last_error_code='PRE_HEARTBEAT_KILL_TERMINAL'
        AND completed_at > now() - interval '5 minutes' AND package_id IS NOT NULL
    )
    RETURNING cp.id
  )
  SELECT count(*) INTO v_quarantined_pkgs FROM q;

  -- (PHK-B) Requeue (count++) when below threshold (count < max_phk - 1 → still safe)
  WITH phk_requeue AS (
    SELECT id, COALESCE((meta->>'pre_heartbeat_kill_count')::int, 0) AS phk_count
    FROM public.job_queue
    WHERE status='processing' AND last_heartbeat_at IS NULL AND locked_at IS NOT NULL
      AND locked_at < v_phk_cutoff
      AND COALESCE((meta->>'pre_heartbeat_kill_count')::int, 0) < (v_max_phk - 1)
      AND COALESCE(attempts,0) < COALESCE(max_attempts,25)
    FOR UPDATE SKIP LOCKED
  ),
  upd_phk_requeue AS (
    UPDATE public.job_queue jq
    SET status='pending', locked_at=NULL, locked_by=NULL, last_heartbeat_at=NULL,
        liveness_status='pre_heartbeat_killed',
        last_error='PRE_HEARTBEAT_KILL: claimed but no heartbeat in 3min — requeued (#'||(p.phk_count+1)||')',
        last_error_code='PRE_HEARTBEAT_KILL',
        run_after = now() + interval '5 minutes' + (random() * interval '60 seconds'),
        meta = COALESCE(jq.meta,'{}'::jsonb) || jsonb_build_object(
          'pre_heartbeat_kill_count', p.phk_count + 1,
          'last_pre_heartbeat_kill_at', to_jsonb(now())),
        updated_at=now()
    FROM phk_requeue p WHERE jq.id = p.id
    RETURNING jq.id
  )
  SELECT count(*) INTO v_phk_requeued FROM upd_phk_requeue;

  -- (a) Generic loop-kill — exclude pre-heartbeat-kills (handled above)
  WITH loop_jobs AS (
    SELECT id FROM public.job_queue
    WHERE status='processing' AND COALESCE(last_heartbeat_at, locked_at, started_at) < v_cutoff
      AND COALESCE((meta->>'stale_reap_count')::int,0) >= v_max_reaps
      AND NOT (last_heartbeat_at IS NULL AND locked_at IS NOT NULL)
    FOR UPDATE SKIP LOCKED
  ),
  upd_loop AS (
    UPDATE public.job_queue jq
    SET status='failed', completed_at=now(), locked_at=NULL, locked_by=NULL,
        liveness_status='killed',
        last_error='STALE_REAP_LOOP_TERMINAL: reaped >= '||v_max_reaps||' times without progress',
        last_error_code='STALE_REAP_LOOP_TERMINAL',
        meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
          'stale_reap_terminal_at', to_jsonb(now()),
          'stale_reap_count', COALESCE((meta->>'stale_reap_count')::int,0)+1),
        updated_at=now()
    FROM loop_jobs lj WHERE jq.id = lj.id
    RETURNING jq.id
  )
  SELECT count(*) INTO v_loop_killed FROM upd_loop;

  -- (b) Generic stale-reap requeue — exclude PHK rows
  WITH stale AS (
    SELECT id, COALESCE((meta->>'stale_reap_count')::int,0) AS reap_count
    FROM public.job_queue
    WHERE status='processing' AND COALESCE(last_heartbeat_at, locked_at, started_at) < v_cutoff
      AND COALESCE(attempts,0) < COALESCE(max_attempts,25)
      AND COALESCE((meta->>'stale_reap_count')::int,0) < v_max_reaps
      AND NOT (last_heartbeat_at IS NULL AND locked_at IS NOT NULL)
    FOR UPDATE SKIP LOCKED
  ),
  upd AS (
    UPDATE public.job_queue jq
    SET status='pending', locked_at=NULL, locked_by=NULL, last_heartbeat_at=NULL,
        liveness_status='suspect',
        last_error='STALE_PROCESSING_REAPED: heartbeat older than '||p_stale_minutes||'min — auto-requeued (reap #'||(s.reap_count+1)||')',
        last_error_code='STALE_PROCESSING_REAPED',
        run_after = now() + interval '60 seconds',
        meta = COALESCE(jq.meta,'{}'::jsonb) || jsonb_build_object(
          'stale_reap_count', s.reap_count+1, 'last_stale_reap_at', to_jsonb(now())),
        updated_at=now()
    FROM stale s WHERE jq.id = s.id
    RETURNING jq.id
  )
  SELECT count(*) INTO v_requeued FROM upd;

  -- (c) Exhausted — exclude PHK rows
  WITH stale_exhausted AS (
    SELECT id FROM public.job_queue
    WHERE status='processing' AND COALESCE(last_heartbeat_at, locked_at, started_at) < v_cutoff
      AND COALESCE(attempts,0) >= COALESCE(max_attempts,25)
      AND NOT (last_heartbeat_at IS NULL AND locked_at IS NOT NULL)
    FOR UPDATE SKIP LOCKED
  ),
  upd2 AS (
    UPDATE public.job_queue jq
    SET status='failed', completed_at=now(), locked_at=NULL, locked_by=NULL,
        liveness_status='killed',
        last_error='STALE_PROCESSING_EXHAUSTED: heartbeat lost AND max_attempts reached',
        last_error_code='STALE_PROCESSING_EXHAUSTED',
        updated_at=now()
    FROM stale_exhausted s WHERE jq.id = s.id
    RETURNING jq.id
  )
  SELECT count(*) INTO v_failed FROM upd2;

  IF v_requeued > 0 OR v_failed > 0 OR v_loop_killed > 0 OR v_phk_requeued > 0 OR v_phk_terminal > 0 THEN
    INSERT INTO public.auto_heal_log(action_type, trigger_source, result_status, result_detail, metadata)
    VALUES ('reap_stale_processing','cron','applied',
      format('requeued=%s exhausted=%s loop_killed=%s phk_requeued=%s phk_terminal=%s quarantined_pkgs=%s',
             v_requeued, v_failed, v_loop_killed, v_phk_requeued, v_phk_terminal, v_quarantined_pkgs),
      jsonb_build_object('requeued',v_requeued,'failed',v_failed,'loop_killed',v_loop_killed,
                        'phk_requeued',v_phk_requeued,'phk_terminal',v_phk_terminal,
                        'quarantined_pkgs',v_quarantined_pkgs,
                        'stale_minutes',p_stale_minutes,'max_reaps',v_max_reaps,'max_phk',v_max_phk));
  END IF;

  RETURN jsonb_build_object('ok',true,
    'requeued',v_requeued,'failed',v_failed,'loop_killed',v_loop_killed,
    'phk_requeued',v_phk_requeued,'phk_terminal',v_phk_terminal,
    'quarantined_pkgs',v_quarantined_pkgs,
    'stale_minutes',p_stale_minutes,'max_reaps',v_max_reaps,'max_phk',v_max_phk);
END;
$function$;

-- 2) View: ensure count(*) usage (was already correct but recreated with ordering safety)
DROP VIEW IF EXISTS public.v_pre_heartbeat_kill_risk CASCADE;
CREATE VIEW public.v_pre_heartbeat_kill_risk AS
WITH phk_events AS (
  SELECT job_type, COALESCE(lane,'default') AS lane, COALESCE(worker_pool,'default') AS worker_pool,
         package_id, last_error_code, completed_at, updated_at
  FROM public.job_queue
  WHERE last_error_code IN ('PRE_HEARTBEAT_KILL','PRE_HEARTBEAT_KILL_TERMINAL','PRE_HEARTBEAT_QUARANTINED')
    AND COALESCE(completed_at, updated_at) > now() - interval '24 hours'
)
SELECT job_type, lane, worker_pool,
       COUNT(*) FILTER (WHERE COALESCE(completed_at,updated_at) > now() - interval '1 hour') AS phk_1h,
       COUNT(*) AS phk_24h,
       COUNT(*) FILTER (WHERE last_error_code='PRE_HEARTBEAT_KILL_TERMINAL') AS phk_terminal_24h,
       COUNT(DISTINCT package_id) AS distinct_packages_24h,
       MAX(COALESCE(completed_at,updated_at)) AS last_kill_at
FROM phk_events
GROUP BY job_type, lane, worker_pool
ORDER BY phk_24h DESC, phk_terminal_24h DESC;

REVOKE ALL ON public.v_pre_heartbeat_kill_risk FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_pre_heartbeat_kill_risk TO service_role;

-- Re-grant after CASCADE drop
CREATE OR REPLACE FUNCTION public.admin_get_pre_heartbeat_kill_risk()
RETURNS TABLE(job_type text, lane text, worker_pool text,
              phk_1h bigint, phk_24h bigint, phk_terminal_24h bigint,
              distinct_packages_24h bigint, last_kill_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  RETURN QUERY
  SELECT v.job_type, v.lane, v.worker_pool, v.phk_1h, v.phk_24h, v.phk_terminal_24h,
         v.distinct_packages_24h, v.last_kill_at
  FROM public.v_pre_heartbeat_kill_risk v;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_pre_heartbeat_kill_risk() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_pre_heartbeat_kill_risk() TO authenticated, service_role;

-- 3) Helper grant: service_role only
REVOKE ALL ON FUNCTION public.fn_is_pre_heartbeat_kill(timestamptz,timestamptz,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_is_pre_heartbeat_kill(timestamptz,timestamptz,int) TO service_role;

-- 4) admin_clear_pre_heartbeat_quarantine — actor in metadata, manual_bypass=true
CREATE OR REPLACE FUNCTION public.admin_clear_pre_heartbeat_quarantine(p_package_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_was_active boolean; v_actor uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_actor,'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'reason required (min 5 chars)';
  END IF;
  SELECT COALESCE((feature_flags->'pre_heartbeat_quarantine'->>'active')::boolean,false)
    INTO v_was_active FROM public.course_packages WHERE id = p_package_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','package_not_found'); END IF;
  IF NOT v_was_active THEN RETURN jsonb_build_object('ok',true,'status','skipped','reason','not_quarantined'); END IF;

  UPDATE public.course_packages
  SET feature_flags = COALESCE(feature_flags,'{}'::jsonb) || jsonb_build_object(
        'pre_heartbeat_quarantine',
          COALESCE(feature_flags->'pre_heartbeat_quarantine','{}'::jsonb)
          || jsonb_build_object(
            'active', false,
            'manual_bypass', true,
            'cleared_at', to_jsonb(now()),
            'cleared_by', to_jsonb(v_actor),
            'cleared_reason', p_reason
          )),
      updated_at = now()
  WHERE id = p_package_id;

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, trigger_source, result_status, result_detail, metadata)
  VALUES ('clear_pre_heartbeat_quarantine','package',p_package_id,'admin_ui','applied',p_reason,
          jsonb_build_object('reason',p_reason,'actor',v_actor));

  RETURN jsonb_build_object('ok',true,'status','cleared','package_id',p_package_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_clear_pre_heartbeat_quarantine(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_clear_pre_heartbeat_quarantine(uuid,text) TO authenticated, service_role;

-- 5) admin_lane_e2e_smoke — v_lane (no shadowing) and explicit jq.lane reference
CREATE OR REPLACE FUNCTION public.admin_lane_e2e_smoke()
RETURNS TABLE(lane text, pool text, pending bigint, processing bigint, failed_15m bigint,
              failure_rate_15m numeric, recommended_burst int, pulse_decision text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_lane text; v_pool text := 'default';
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  FOR v_lane IN SELECT unnest(ARRAY['control','generation','content','recovery','default']) LOOP
    RETURN QUERY
    WITH q AS (
      SELECT
        COUNT(*) FILTER (WHERE jq.status='pending')::bigint AS pending_n,
        COUNT(*) FILTER (WHERE jq.status='processing')::bigint AS processing_n,
        COUNT(*) FILTER (WHERE jq.status='failed' AND COALESCE(jq.completed_at,jq.updated_at) > now() - interval '15 min')::bigint AS failed_15m_n
      FROM public.job_queue jq
      WHERE COALESCE(jq.lane,'default') = v_lane AND COALESCE(jq.worker_pool,'default') = v_pool
    ),
    rate AS (SELECT public.fn_lane_failure_rate_15m(v_lane, v_pool) AS r)
    SELECT v_lane, v_pool, q.pending_n, q.processing_n, q.failed_15m_n, rate.r,
           public.fn_adaptive_burst_size_v2(q.pending_n::int, rate.r, 0, v_lane, v_pool),
           CASE WHEN q.pending_n > 100 THEN 'eligible' ELSE 'idle' END
    FROM q, rate;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_lane_e2e_smoke() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_lane_e2e_smoke() TO authenticated, service_role;

-- 6) Read-only smoke (no mutation)
DO $$
DECLARE v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt FROM public.v_pre_heartbeat_kill_risk;
  RAISE NOTICE 'S5 hotfix smoke ok — phk_risk_rows=%', v_cnt;
END $$;
