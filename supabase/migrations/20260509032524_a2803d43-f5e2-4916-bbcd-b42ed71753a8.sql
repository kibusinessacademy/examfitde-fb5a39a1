-- 1) Bump default batch limit
CREATE OR REPLACE FUNCTION public.claim_pending_jobs_v5(p_worker_id text, p_limit integer DEFAULT 25, p_worker_pool text DEFAULT NULL::text)
 RETURNS SETOF job_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_unique_pkgs int;
  v_per_pkg_cap int;
BEGIN
  SELECT COUNT(DISTINCT (payload->>'package_id'))
    INTO v_unique_pkgs
    FROM public.job_queue
   WHERE status='pending'
     AND (run_after IS NULL OR run_after <= now())
     AND (payload->>'package_id') IS NOT NULL;

  v_per_pkg_cap := LEAST(10, GREATEST(3, CEIL(p_limit::numeric * 1.5 / GREATEST(v_unique_pkgs, 1))::int));

  RETURN QUERY
  WITH candidates AS (
    SELECT jq.id, jq.job_type,
           (jq.payload->>'package_id')::uuid AS pkg_id
    FROM public.job_queue jq
    LEFT JOIN public.course_packages cp
      ON cp.id = (jq.payload->>'package_id')::uuid
    LEFT JOIN public.job_type_policies jtp
      ON jtp.job_type = jq.job_type
    WHERE jq.status = 'pending'
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND (
        CASE
          WHEN p_worker_pool IS NOT NULL THEN
            COALESCE(jq.worker_pool, COALESCE(jtp.worker_pool, 'default')) = p_worker_pool
          ELSE
            COALESCE(jq.worker_pool, COALESCE(jtp.worker_pool, 'default')) = 'default'
        END
      )
      AND (
        cp.id IS NULL
        OR cp.status = 'building'
        OR COALESCE(jtp.can_run_when_not_building, false)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.package_job_quarantine q
        WHERE q.package_id = (jq.payload->>'package_id')::uuid
          AND q.job_type = jq.job_type
          AND q.cleared_at IS NULL
          AND q.blocked_until > now()
      )
      AND (
        jq.job_type NOT LIKE 'package_%'
        OR (jq.payload->>'package_id') IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM public.step_dag_edges dag
          JOIN public.package_steps ps
            ON ps.package_id = (jq.payload->>'package_id')::uuid
            AND ps.step_key = dag.depends_on
          WHERE dag.step_key = replace(jq.job_type, 'package_', '')
            AND ps.status NOT IN ('done', 'skipped')
        )
      )
    ORDER BY jq.priority ASC NULLS LAST, jq.created_at ASC
    FOR UPDATE OF jq SKIP LOCKED
    LIMIT p_limit * 4
  ),
  fair AS (
    SELECT c.id
    FROM (
      SELECT id, pkg_id,
             row_number() OVER (PARTITION BY pkg_id ORDER BY (SELECT NULL)) AS rn
      FROM candidates
    ) c
    WHERE c.rn <= v_per_pkg_cap
    ORDER BY (SELECT NULL)
    LIMIT p_limit
  )
  UPDATE public.job_queue q
  SET status = 'processing',
      locked_at = now(),
      locked_by = p_worker_id,
      started_at = now(),
      attempts = COALESCE(q.attempts, 0) + 1,
      updated_at = now()
  FROM fair f
  WHERE q.id = f.id
  RETURNING q.*;
END;
$function$;

-- 2) Recovery-Lane Pulse (drain mode, ignores per-pkg fairness, service_role only)
CREATE OR REPLACE FUNCTION public.claim_recovery_pulse(p_worker_id text, p_limit integer DEFAULT 50, p_worker_pool text DEFAULT 'default')
 RETURNS SETOF job_queue
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('role', true) NOT IN ('service_role','postgres') THEN
    RAISE EXCEPTION 'recovery_pulse requires service_role';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT jq.id
    FROM public.job_queue jq
    LEFT JOIN public.course_packages cp
      ON cp.id = (jq.payload->>'package_id')::uuid
    LEFT JOIN public.job_type_policies jtp
      ON jtp.job_type = jq.job_type
    WHERE jq.status = 'pending'
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND COALESCE(jq.worker_pool, COALESCE(jtp.worker_pool, 'default')) = p_worker_pool
      AND (cp.id IS NULL OR cp.status = 'building' OR COALESCE(jtp.can_run_when_not_building, false))
      AND NOT EXISTS (
        SELECT 1 FROM public.package_job_quarantine q
        WHERE q.package_id = (jq.payload->>'package_id')::uuid
          AND q.job_type = jq.job_type
          AND q.cleared_at IS NULL
          AND q.blocked_until > now()
      )
      AND (
        jq.job_type NOT LIKE 'package_%'
        OR (jq.payload->>'package_id') IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM public.step_dag_edges dag
          JOIN public.package_steps ps
            ON ps.package_id = (jq.payload->>'package_id')::uuid
            AND ps.step_key = dag.depends_on
          WHERE dag.step_key = replace(jq.job_type, 'package_', '')
            AND ps.status NOT IN ('done', 'skipped')
        )
      )
    ORDER BY jq.priority ASC NULLS LAST, jq.created_at ASC
    FOR UPDATE OF jq SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.job_queue q
  SET status='processing', locked_at=now(), locked_by=p_worker_id,
      started_at=now(), attempts=COALESCE(q.attempts,0)+1, updated_at=now()
  FROM candidates c
  WHERE q.id = c.id
  RETURNING q.*;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_recovery_pulse(text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_recovery_pulse(text,integer,text) TO service_role;

-- 3) Gap-Sync Audit View per lane
CREATE OR REPLACE VIEW public.v_dag_gap_sync_per_lane AS
SELECT
  COALESCE(jq.lane, 'unknown') AS lane,
  v.block_reason,
  COUNT(*)::int AS jobs,
  COUNT(DISTINCT v.package_id)::int AS packages,
  MAX(v.minutes_blocked)::int AS max_minutes_blocked,
  AVG(v.minutes_blocked)::int AS avg_minutes_blocked,
  COUNT(*) FILTER (WHERE v.bronze_locked) AS bronze_locked_jobs
FROM public.v_dag_blocked_jobs v
JOIN public.job_queue jq ON jq.id = v.job_id
GROUP BY 1,2;

REVOKE ALL ON public.v_dag_gap_sync_per_lane FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_dag_gap_sync_per_lane TO service_role;

-- Admin RPC wrapper
CREATE OR REPLACE FUNCTION public.admin_get_dag_gap_sync()
RETURNS TABLE(lane text, block_reason text, jobs int, packages int,
              max_minutes_blocked int, avg_minutes_blocked int, bronze_locked_jobs bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  RETURN QUERY SELECT * FROM public.v_dag_gap_sync_per_lane ORDER BY jobs DESC;
END $$;

REVOKE ALL ON FUNCTION public.admin_get_dag_gap_sync() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_dag_gap_sync() TO authenticated, service_role;

-- 4) Suppression Helper (pure, testable)
CREATE OR REPLACE FUNCTION public.fn_should_suppress_cta_visible(p_baseline_3h int, p_c1h int, p_c24h int)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (COALESCE(p_c1h,0)=0 AND COALESCE(p_c24h,0)>0 AND COALESCE(p_baseline_3h,0) < 10)
$$;

-- 5) E2E Heal Smoke: snapshot block-reasons
CREATE OR REPLACE FUNCTION public.admin_smoke_dag_heal_counters()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  SELECT jsonb_object_agg(block_reason, jobs) INTO v
  FROM (
    SELECT block_reason, COUNT(*)::int AS jobs
    FROM public.v_dag_blocked_jobs GROUP BY 1
  ) x;
  RETURN jsonb_build_object(
    'at', now(),
    'total_blocked', (SELECT COUNT(*) FROM public.v_dag_blocked_jobs),
    'by_reason', COALESCE(v,'{}'::jsonb),
    'pending_total', (SELECT COUNT(*) FROM public.job_queue WHERE status='pending'),
    'processing_total', (SELECT COUNT(*) FROM public.job_queue WHERE status='processing')
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_smoke_dag_heal_counters() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_smoke_dag_heal_counters() TO authenticated, service_role;

-- 6) Re-bind cron alert function to use Helper
CREATE OR REPLACE FUNCTION public.cron_check_launch_readiness_alerts()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_traffic jsonb; v_orders jsonb;
  v_count int := 0; v_window timestamptz := date_trunc('hour', now());
  v_key text; v_sev text; v_sum text; v_det jsonb;
  v_baseline_3h int;
  v_c1h int; v_c24h int;
  v_cta_visible_suppressed boolean := false;
BEGIN
  v_traffic := public.fn_launch_live_traffic_counts();
  v_orders  := public.fn_launch_orders_health();

  SELECT COUNT(*) INTO v_baseline_3h
    FROM public.conversion_events
   WHERE created_at BETWEEN now() - interval '4 hours' AND now() - interval '1 hour'
     AND event_type IN ('page_view','lead_magnet_view','quiz_started','cta_visible','cta_click');

  v_c1h := COALESCE((v_traffic->'cta_visible'->>'c1h')::int,0);
  v_c24h := COALESCE((v_traffic->'cta_visible'->>'c24h')::int,0);

  IF v_c1h=0 AND v_c24h>0 THEN
    IF public.fn_should_suppress_cta_visible(v_baseline_3h, v_c1h, v_c24h) THEN
      v_cta_visible_suppressed := true;
    ELSE
      v_key:='launch.tracking.cta_visible_stall'; v_sev:='warn';
      v_sum:='cta_visible: keine Events in letzter Stunde (24h hatte Traffic)';
      v_det:=jsonb_build_object('counts',v_traffic->'cta_visible','traffic_baseline_3h',v_baseline_3h);
      PERFORM public.ops_raise_alert(v_key,v_sev,v_sum,v_det);
      INSERT INTO public.launch_alert_email_outbox(alert_key,severity,summary,details,dedupe_window_start)
      VALUES (v_key,v_sev,v_sum,v_det,v_window) ON CONFLICT DO NOTHING;
      v_count:=v_count+1;
    END IF;
  END IF;

  IF COALESCE((v_traffic->'quiz_started'->>'c24h')::int,0)>0
     AND COALESCE((v_traffic->'quiz_started'->>'c1h')::int,0)=0
     AND COALESCE((v_traffic->'cta_clicked'->>'c1h')::int,0)>0 THEN
    v_key:='launch.tracking.quiz_started_drop'; v_sev:='warn';
    v_sum:='quiz_started=0 trotz cta_clicked>0 in letzter Stunde';
    v_det:=jsonb_build_object('traffic',v_traffic);
    PERFORM public.ops_raise_alert(v_key,v_sev,v_sum,v_det);
    INSERT INTO public.launch_alert_email_outbox(alert_key,severity,summary,details,dedupe_window_start)
    VALUES (v_key,v_sev,v_sum,v_det,v_window) ON CONFLICT DO NOTHING;
    v_count:=v_count+1;
  END IF;

  IF COALESCE((v_orders->>'paid_no_grant')::int,0)>0 THEN
    v_key:='launch.orders.paid_no_grant'; v_sev:='critical';
    v_sum:=format('paid_no_grant=%s in letzten 24h',v_orders->>'paid_no_grant');
    v_det:=v_orders;
    PERFORM public.ops_raise_alert(v_key,v_sev,v_sum,v_det);
    INSERT INTO public.launch_alert_email_outbox(alert_key,severity,summary,details,dedupe_window_start)
    VALUES (v_key,v_sev,v_sum,v_det,v_window) ON CONFLICT DO NOTHING;
    v_count:=v_count+1;
  END IF;

  IF COALESCE((v_orders->>'pending_no_session')::int,0)>=5 THEN
    v_key:='launch.orders.pending_no_session_high'; v_sev:='warn';
    v_sum:=format('pending_no_session=%s in letzten 24h',v_orders->>'pending_no_session');
    v_det:=v_orders;
    PERFORM public.ops_raise_alert(v_key,v_sev,v_sum,v_det);
    INSERT INTO public.launch_alert_email_outbox(alert_key,severity,summary,details,dedupe_window_start)
    VALUES (v_key,v_sev,v_sum,v_det,v_window) ON CONFLICT DO NOTHING;
    v_count:=v_count+1;
  END IF;

  INSERT INTO public.auto_heal_log(action_type,target_type,result_status,metadata)
  VALUES ('launch_readiness_alert_check','system',
          CASE WHEN v_count=0 THEN 'success' ELSE 'warn' END,
          jsonb_build_object(
            'alert_count', v_count,
            'traffic', v_traffic,
            'orders', v_orders,
            'traffic_baseline_3h', v_baseline_3h,
            'cta_visible_suppressed', v_cta_visible_suppressed
          ));
  RETURN jsonb_build_object('ok',true,'alert_count',v_count,'cta_visible_suppressed',v_cta_visible_suppressed);
END $function$;

-- 7) Inline SQL self-test (4 paths) for fn_should_suppress_cta_visible
DO $$
BEGIN
  -- Suppress: low baseline, c1h=0, c24h>0
  IF NOT public.fn_should_suppress_cta_visible(5, 0, 27) THEN
    RAISE EXCEPTION 'suppress test 1 failed (low baseline must suppress)';
  END IF;
  -- Fire: enough baseline
  IF public.fn_should_suppress_cta_visible(15, 0, 27) THEN
    RAISE EXCEPTION 'suppress test 2 failed (high baseline must NOT suppress)';
  END IF;
  -- No-op: c1h>0
  IF public.fn_should_suppress_cta_visible(5, 3, 27) THEN
    RAISE EXCEPTION 'suppress test 3 failed (c1h>0 must NOT suppress)';
  END IF;
  -- No-op: c24h=0
  IF public.fn_should_suppress_cta_visible(5, 0, 0) THEN
    RAISE EXCEPTION 'suppress test 4 failed (c24h=0 must NOT suppress)';
  END IF;
END $$;

-- 8) Audit
INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
VALUES ('worker_burst_and_audit_v3','system','success',
  jsonb_build_object(
    'changes', jsonb_build_array(
      'claim_pending_jobs_v5 default p_limit 10->25',
      'claim_recovery_pulse added (service_role)',
      'v_dag_gap_sync_per_lane + admin_get_dag_gap_sync',
      'fn_should_suppress_cta_visible extracted+tested',
      'admin_smoke_dag_heal_counters added'
    )
  ));