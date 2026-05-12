
-- ------------------------------------------------------------
-- 1) admin_pipeline_worker_restart: kontrollierter Retry/Reap
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_pipeline_worker_restart(
  p_window_minutes int DEFAULT 60,
  p_max_requeue int DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_run_id uuid := gen_random_uuid();
  v_reaped jsonb := '{}'::jsonb;
  v_requeued int := 0;
  v_requeued_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF NOT public.fn_is_admin_or_service_role(v_caller) THEN
    RAISE EXCEPTION 'forbidden: admin or service_role required';
  END IF;

  -- Stale processing-Jobs reapen (Standard-Reaper)
  BEGIN
    v_reaped := COALESCE(public.fn_reap_stale_processing_jobs(), '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_reaped := jsonb_build_object('error', SQLERRM);
  END;

  -- Transient infra/rate_limit Failures requeuen
  WITH cand AS (
    SELECT j.id
    FROM public.job_queue j
    WHERE j.status = 'failed'
      AND j.updated_at > now() - make_interval(mins => p_window_minutes)
      AND (
        COALESCE(j.last_error_code,'') ILIKE '%TIMEOUT%'
        OR COALESCE(j.last_error_code,'') ILIKE '%CPU%'
        OR COALESCE(j.last_error_code,'') = 'WORKER_KILLED'
        OR COALESCE(j.last_error_code,'') ILIKE '%RATE_LIMIT%'
        OR COALESCE(j.last_error_code,'') ILIKE '%429%'
      )
    ORDER BY j.updated_at DESC
    LIMIT p_max_requeue
  ),
  upd AS (
    UPDATE public.job_queue j
       SET status = 'queued',
           updated_at = now(),
           run_after = now(),
           last_error = NULL,
           last_error_code = NULL,
           attempts = COALESCE(attempts, 0)
     FROM cand
     WHERE j.id = cand.id
     RETURNING j.id
  )
  SELECT COUNT(*)::int, COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO v_requeued, v_requeued_ids
  FROM upd;

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES (
    'admin_pipeline_worker_restart',
    'system',
    CASE WHEN v_requeued > 0 OR (v_reaped ? 'reaped') THEN 'success' ELSE 'noop' END,
    jsonb_build_object(
      'run_id', v_run_id,
      'caller_id', v_caller,
      'window_minutes', p_window_minutes,
      'requeued', v_requeued,
      'requeued_ids', to_jsonb(v_requeued_ids),
      'reaper', v_reaped
    )
  );

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'requeued', v_requeued,
    'requeued_ids', to_jsonb(v_requeued_ids),
    'reaper', v_reaped
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_pipeline_worker_restart(int,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_pipeline_worker_restart(int,int) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 2) Launch-Readiness Pipeline-Achse: nur Blocker treiben Status
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_launch_readiness_drilldown()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_snap record;
  v_axes jsonb := '[]'::jsonb;
  v_orders jsonb;
  v_traffic jsonb;
  v_pipeline_status text := 'green';
  v_pipeline_reasons text[] := ARRAY[]::text[];
  v_failed_total int := 0;
  v_failed_blocking int := 0;
  v_failed_expected int := 0;
BEGIN
  IF NOT public.fn_is_admin_or_service_role(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden: admin or service_role required';
  END IF;

  SELECT * INTO v_snap
  FROM public.launch_readiness_snapshots
  ORDER BY taken_at DESC LIMIT 1;

  IF v_snap.id IS NULL THEN
    RETURN jsonb_build_object('error','no_snapshot');
  END IF;

  -- ORDERS axis
  v_orders := public.fn_launch_orders_health();
  v_axes := v_axes || jsonb_build_object(
    'axis','orders',
    'status', CASE
      WHEN COALESCE((v_orders->>'paid_no_grant')::int,0) > 0 THEN 'red'
      WHEN COALESCE((v_orders->>'pending_no_session')::int,0) >= 5 THEN 'yellow'
      ELSE 'green' END,
    'reasons', ARRAY[
      format('paid_no_grant_24h=%s', COALESCE((v_orders->>'paid_no_grant')::int,0)),
      format('orders_paid_24h=%s', COALESCE((v_orders->>'paid')::int,0))
    ],
    'metrics', v_orders,
    'route', '/admin/ops/orders',
    'cta', 'Orders öffnen'
  );

  -- TRAFFIC axis
  v_traffic := public.fn_launch_live_traffic_counts();
  v_axes := v_axes || jsonb_build_object(
    'axis','traffic',
    'status', CASE
      WHEN COALESCE((v_traffic->'cta_visible'->>'c24h')::int,0) >= 50
       AND COALESCE((v_traffic->'cta_clicked'->>'c24h')::int,0) = 0 THEN 'yellow'
      WHEN v_snap.can_public_launch THEN 'green'
      ELSE 'yellow' END,
    'reasons', ARRAY[
      format('cta_visible_24h=%s', COALESCE((v_traffic->'cta_visible'->>'c24h')::int,0)),
      format('quiz_started_24h=%s', COALESCE((v_traffic->'quiz_started'->>'c24h')::int,0))
    ],
    'metrics', v_traffic,
    'route', '/admin/ops/funnel',
    'cta', 'Funnel öffnen'
  );

  -- SEO axis
  v_axes := v_axes || jsonb_build_object(
    'axis','seo',
    'status', CASE WHEN v_snap.empty_published > 50 THEN 'red'
                   WHEN v_snap.empty_published > 0 THEN 'yellow' ELSE 'green' END,
    'reasons', ARRAY[
      format('empty_published=%s', v_snap.empty_published),
      format('sellable_courses=%s', v_snap.sellable_courses)
    ],
    'metrics', jsonb_build_object(
      'empty_published', v_snap.empty_published,
      'sellable_courses', v_snap.sellable_courses,
      'pricing_ready', v_snap.pricing_ready
    ),
    'route', '/admin/growth',
    'cta', 'SEO/Growth öffnen'
  );

  -- GROWTH axis
  v_axes := v_axes || jsonb_build_object(
    'axis','growth',
    'status', CASE WHEN COALESCE(v_snap.checkout_started_24h,0) > 0 THEN 'green' ELSE 'yellow' END,
    'reasons', ARRAY[
      format('checkout_started_24h=%s', COALESCE(v_snap.checkout_started_24h,0)),
      format('quiz_started_24h=%s', COALESCE(v_snap.quiz_started_24h,0))
    ],
    'metrics', jsonb_build_object(
      'checkout_started_24h', v_snap.checkout_started_24h,
      'quiz_started_24h', v_snap.quiz_started_24h
    ),
    'route', '/admin/growth',
    'cta', 'SEO/Growth öffnen'
  );

  -- PIPELINE axis (klassifikations-bewusst)
  WITH base AS (
    SELECT
      CASE
        WHEN COALESCE(j.last_error_code,'') IN ('BRONZE_LOCKED','PHANTOM_BLOCKED','REENTRY_GUARD','GUARD_BLOCKED')
          THEN 'expected_guard'
        WHEN COALESCE(j.last_error_code,'') ILIKE '%TIMEOUT%'
          OR COALESCE(j.last_error_code,'') ILIKE '%CPU%'
          OR COALESCE(j.last_error_code,'') = 'WORKER_KILLED'
          THEN 'infra_transient'
        WHEN COALESCE(j.last_error_code,'') ILIKE '%RATE_LIMIT%'
          OR COALESCE(j.last_error_code,'') ILIKE '%429%'
          THEN 'rate_limit'
        ELSE 'pipeline_blocker'
      END AS cls
    FROM public.job_queue j
    WHERE j.status='failed'
      AND j.updated_at > now() - interval '1 hour'
  )
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE cls = 'expected_guard')::int,
    COUNT(*) FILTER (WHERE cls <> 'expected_guard')::int
  INTO v_failed_total, v_failed_expected, v_failed_blocking
  FROM base;

  IF v_failed_blocking > 20 THEN
    v_pipeline_status := 'red';
    v_pipeline_reasons := array_append(v_pipeline_reasons, format('blocking_failures_1h=%s (>20)', v_failed_blocking));
  ELSIF v_failed_blocking > 5 THEN
    v_pipeline_status := 'yellow';
    v_pipeline_reasons := array_append(v_pipeline_reasons, format('blocking_failures_1h=%s', v_failed_blocking));
  END IF;
  IF v_failed_expected > 0 THEN
    v_pipeline_reasons := array_append(v_pipeline_reasons, format('expected_guard_1h=%s (info)', v_failed_expected));
  END IF;

  v_axes := v_axes || jsonb_build_object(
    'axis','pipeline',
    'status', v_pipeline_status,
    'reasons', v_pipeline_reasons,
    'metrics', jsonb_build_object(
      'failed_jobs_1h', v_failed_total,
      'blocking_failures_1h', v_failed_blocking,
      'expected_guard_1h', v_failed_expected
    ),
    'route', '/admin/heal',
    'cta', 'Heal-Hub öffnen'
  );

  RETURN jsonb_build_object(
    'taken_at', v_snap.taken_at,
    'overall_status', v_snap.overall_status,
    'can_soft_launch', v_snap.can_soft_launch,
    'can_public_launch', v_snap.can_public_launch,
    'axes', v_axes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_launch_readiness_drilldown() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_launch_readiness_drilldown() TO authenticated, service_role;
