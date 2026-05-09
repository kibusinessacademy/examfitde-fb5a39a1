-- 1) Adaptive Burst Size (deterministic)
CREATE OR REPLACE FUNCTION public.fn_adaptive_burst_size(p_pending int)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN COALESCE(p_pending,0) > 1000 THEN 75
    WHEN COALESCE(p_pending,0) > 500  THEN 50
    WHEN COALESCE(p_pending,0) > 100  THEN 35
    ELSE 25
  END
$$;

-- 2) Worker Health Gate
CREATE OR REPLACE FUNCTION public.fn_worker_health_gate()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_processing int;
  v_reaper_kills_5m int;
  v_db_latency_ms numeric;
  v_proc_cap_ok boolean;
  v_reaper_low boolean;
  v_db_ok boolean;
  v_t0 timestamptz;
BEGIN
  SELECT COUNT(*)::int INTO v_processing FROM public.job_queue WHERE status='processing';
  SELECT COUNT(*)::int INTO v_reaper_kills_5m FROM public.auto_heal_log
    WHERE action_type IN ('reap_stale_processing','reap_stale_processing_hard_fail')
      AND created_at >= now() - interval '5 minutes';

  v_t0 := clock_timestamp();
  PERFORM 1 FROM public.job_queue LIMIT 1;
  v_db_latency_ms := EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000;

  v_proc_cap_ok := v_processing < 50;        -- arbitrary safe ceiling
  v_reaper_low  := v_reaper_kills_5m < 5;
  v_db_ok       := v_db_latency_ms < 250;

  RETURN jsonb_build_object(
    'healthy', (v_proc_cap_ok AND v_reaper_low AND v_db_ok),
    'processing', v_processing,
    'processing_capacity_available', v_proc_cap_ok,
    'reaper_kills_5m', v_reaper_kills_5m,
    'reaper_low', v_reaper_low,
    'db_latency_ms', v_db_latency_ms,
    'db_latency_ok', v_db_ok,
    'measured_at', now()
  );
END $$;

-- 3) Auto Recovery Pulse Decide (called by cron)
CREATE OR REPLACE FUNCTION public.fn_auto_recovery_pulse_decide()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_pending int;
  v_oldest_min int;
  v_gate jsonb;
  v_burst int;
  v_pulsed_ids uuid[];
  v_pulse_count int := 0;
  v_decision text;
BEGIN
  SELECT COUNT(*)::int,
         COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at)))/60,0)::int
    INTO v_pending, v_oldest_min
    FROM public.job_queue
   WHERE status='pending'
     AND (run_after IS NULL OR run_after <= now())
     AND COALESCE(worker_pool, 'default') = 'default';

  v_gate  := public.fn_worker_health_gate();
  v_burst := public.fn_adaptive_burst_size(v_pending);

  IF v_pending <= 100 THEN
    v_decision := 'noop_below_threshold';
  ELSIF v_oldest_min < 10 THEN
    v_decision := 'noop_oldest_under_10min';
  ELSIF NOT (v_gate->>'healthy')::boolean THEN
    v_decision := 'noop_gate_unhealthy';
  ELSE
    SELECT array_agg(j.id) INTO v_pulsed_ids FROM public.claim_recovery_pulse(
      'auto_recovery_pulse_cron', LEAST(v_burst, 50), 'default'
    ) j;
    v_pulse_count := COALESCE(array_length(v_pulsed_ids,1),0);
    v_decision := 'pulsed';
  END IF;

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('auto_recovery_pulse_decide','system',
          CASE WHEN v_decision='pulsed' THEN 'success' ELSE 'noop' END,
          jsonb_build_object(
            'decision', v_decision,
            'pending', v_pending,
            'oldest_min', v_oldest_min,
            'gate', v_gate,
            'burst_size', v_burst,
            'pulsed', v_pulse_count
          ));

  RETURN jsonb_build_object(
    'decision', v_decision, 'pending', v_pending, 'oldest_min', v_oldest_min,
    'burst_size', v_burst, 'pulsed', v_pulse_count, 'gate', v_gate
  );
END $$;
REVOKE ALL ON FUNCTION public.fn_auto_recovery_pulse_decide() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_auto_recovery_pulse_decide() TO service_role;

-- 4) Forensics RPC
CREATE OR REPLACE FUNCTION public.admin_get_worker_throughput_forensics()
RETURNS TABLE(
  pool text, pending int, processing int, oldest_pending_sec int,
  unique_pkgs int, batch_default int, recommended_burst int,
  recovery_pulse_eligible boolean, gate jsonb, tip text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; v_gate jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  v_gate := public.fn_worker_health_gate();

  FOR r IN
    SELECT
      COALESCE(jq.worker_pool, jtp.worker_pool, 'default') AS effective_pool,
      COUNT(*) FILTER (WHERE jq.status='pending' AND (jq.run_after IS NULL OR jq.run_after<=now()))::int AS pend,
      COUNT(*) FILTER (WHERE jq.status='processing')::int AS proc,
      COALESCE(EXTRACT(EPOCH FROM now()-MIN(jq.created_at) FILTER (WHERE jq.status='pending')),0)::int AS oldest,
      COUNT(DISTINCT jq.payload->>'package_id') FILTER (WHERE jq.status='pending')::int AS pkgs
    FROM public.job_queue jq
    LEFT JOIN public.job_type_policies jtp ON jtp.job_type=jq.job_type
    WHERE jq.status IN ('pending','processing')
    GROUP BY 1
  LOOP
    pool := r.effective_pool;
    pending := r.pend;
    processing := r.proc;
    oldest_pending_sec := r.oldest;
    unique_pkgs := r.pkgs;
    batch_default := 25;
    recommended_burst := public.fn_adaptive_burst_size(r.pend);
    recovery_pulse_eligible := (
      r.effective_pool='default' AND r.pend>100 AND r.oldest>=600 AND (v_gate->>'healthy')::boolean
    );
    gate := v_gate;
    tip := CASE
      WHEN r.pend=0 THEN 'idle — kein Burst nötig'
      WHEN r.pend>1000 THEN 'extreme backlog → burst 75 + recovery_pulse + scale workers'
      WHEN r.pend>500 THEN 'high backlog → burst 50 + recovery_pulse'
      WHEN r.pend>100 THEN 'moderate backlog → burst 35'
      WHEN r.proc=0 AND r.pend>0 THEN 'pending aber processing=0 — Worker tot? liveness-reconciler prüfen'
      WHEN NOT (v_gate->>'healthy')::boolean THEN 'gate unhealthy — kein Pulse, erst stabilisieren'
      ELSE 'normal'
    END;
    RETURN NEXT;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.admin_get_worker_throughput_forensics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_worker_throughput_forensics() TO authenticated, service_role;

-- 5) Bronze Tail Auto-Unlock (scope-limited)
CREATE OR REPLACE FUNCTION public.admin_bronze_tail_auto_unlock(p_max int DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; v_unlocked int := 0; v_pkgs jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  FOR r IN
    WITH eligible AS (
      SELECT cp.id AS package_id, cp.title,
             (SELECT COUNT(*) FROM public.exam_questions eq
               WHERE eq.package_id=cp.id AND eq.status='approved') AS approved_q,
             (SELECT COUNT(*) FROM public.job_queue jq
               WHERE jq.status='pending'
                 AND (jq.payload->>'package_id')::uuid = cp.id
                 AND jq.job_type IN ('package_run_integrity_check','package_quality_council','package_auto_publish')
                 AND COALESCE((jq.payload->>'bronze_lock_override')::boolean,false) = false
             ) AS locked_tail_jobs
      FROM public.course_packages cp
      WHERE ((cp.feature_flags->'bronze')->>'locked')::boolean = true
        AND cp.status = 'building'
    )
    SELECT * FROM eligible
    WHERE approved_q >= 50 AND locked_tail_jobs > 0
    ORDER BY approved_q DESC
    LIMIT p_max
  LOOP
    UPDATE public.job_queue
       SET payload = payload || jsonb_build_object('bronze_lock_override', true),
           run_after = now(),
           updated_at = now()
     WHERE status='pending'
       AND (payload->>'package_id')::uuid = r.package_id
       AND job_type IN ('package_run_integrity_check','package_quality_council','package_auto_publish');
    GET DIAGNOSTICS v_unlocked = ROW_COUNT;
    v_pkgs := v_pkgs || jsonb_build_object(
      'package_id', r.package_id, 'title', r.title,
      'approved_q', r.approved_q, 'unlocked_jobs', v_unlocked
    );
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('bronze_tail_auto_unlock','system','success',
          jsonb_build_object('packages', v_pkgs, 'p_max', p_max));

  RETURN jsonb_build_object('packages', v_pkgs, 'count', jsonb_array_length(v_pkgs));
END $$;
REVOKE ALL ON FUNCTION public.admin_bronze_tail_auto_unlock(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bronze_tail_auto_unlock(int) TO authenticated, service_role;

-- 6) Pre/Post Smoke for migrations
CREATE OR REPLACE FUNCTION public.admin_smoke_dag_heal_pre_post(p_phase text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_snap jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  IF p_phase NOT IN ('pre','post') THEN
    RAISE EXCEPTION 'p_phase must be pre|post';
  END IF;
  v_snap := public.admin_smoke_dag_heal_counters();
  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('dag_heal_smoke_'||p_phase,'system','success',v_snap);
  RETURN jsonb_build_object('phase', p_phase, 'snapshot', v_snap);
END $$;
REVOKE ALL ON FUNCTION public.admin_smoke_dag_heal_pre_post(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_smoke_dag_heal_pre_post(text) TO authenticated, service_role;

-- 7) Cron auto-recovery-pulse-5min (idempotent unschedule first)
DO $$ BEGIN
  PERFORM cron.unschedule('auto-recovery-pulse-5min');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'auto-recovery-pulse-5min',
  '*/5 * * * *',
  $cmd$ SELECT public.fn_auto_recovery_pulse_decide(); $cmd$
);

-- 8) DO-block self-tests
DO $$
DECLARE g jsonb;
BEGIN
  IF public.fn_adaptive_burst_size(50)   <> 25 THEN RAISE EXCEPTION 'burst test: 50→25 failed'; END IF;
  IF public.fn_adaptive_burst_size(150)  <> 35 THEN RAISE EXCEPTION 'burst test: 150→35 failed'; END IF;
  IF public.fn_adaptive_burst_size(600)  <> 50 THEN RAISE EXCEPTION 'burst test: 600→50 failed'; END IF;
  IF public.fn_adaptive_burst_size(1500) <> 75 THEN RAISE EXCEPTION 'burst test: 1500→75 failed'; END IF;

  g := public.fn_worker_health_gate();
  IF NOT (g ? 'healthy' AND g ? 'processing_capacity_available' AND g ? 'reaper_low' AND g ? 'db_latency_ok') THEN
    RAISE EXCEPTION 'gate shape failed: %', g;
  END IF;
END $$;

-- 9) Audit
INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
VALUES ('adaptive_burst_and_pulse_v4','system','success',
  jsonb_build_object(
    'changes', jsonb_build_array(
      'fn_adaptive_burst_size 25/35/50/75',
      'fn_worker_health_gate (proc cap, reaper, db latency)',
      'fn_auto_recovery_pulse_decide + cron 5min',
      'admin_get_worker_throughput_forensics with tips',
      'admin_bronze_tail_auto_unlock (scope: building+approved>=50+locked-tail)',
      'admin_smoke_dag_heal_pre_post(pre|post)'
    )
  ));