
CREATE OR REPLACE FUNCTION public.get_factory_executive_report()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_waves int := 0;
  v_total_waves int := 0;
  v_total_items int := 0;
  v_published int := 0;
  v_blocked int := 0;
  v_building_packages int := 0;
  v_queued_packages int := 0;
  v_pending_jobs int := 0;
  v_failed_jobs_1h int := 0;
  v_total_ai_cost numeric := 0;
  v_ai_calls int := 0;
  v_by_model jsonb := '[]'::jsonb;
  v_waves jsonb := '[]'::jsonb;
  v_auto_heal_24h int := 0;
  v_auto_heal_success_24h int := 0;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE status = 'active')
  INTO v_total_waves, v_active_waves
  FROM public.production_waves;

  SELECT count(*),
         count(*) FILTER (WHERE status = 'published'),
         count(*) FILTER (WHERE status = 'blocked')
  INTO v_total_items, v_published, v_blocked
  FROM public.production_wave_items;

  SELECT count(*)
  INTO v_building_packages
  FROM public.course_packages
  WHERE status = 'building';

  SELECT count(*)
  INTO v_queued_packages
  FROM public.course_packages
  WHERE status = 'queued';

  SELECT count(*)
  INTO v_pending_jobs
  FROM public.job_queue
  WHERE status IN ('pending','queued','processing');

  SELECT count(*)
  INTO v_failed_jobs_1h
  FROM public.job_queue
  WHERE status = 'failed'
    AND updated_at > now() - interval '1 hour';

  -- AI cost from ai_generations (24h)
  BEGIN
    SELECT COALESCE(sum(cost_eur), 0), count(*)
    INTO v_total_ai_cost, v_ai_calls
    FROM public.ai_generations
    WHERE created_at > now() - interval '24 hours';
  EXCEPTION WHEN OTHERS THEN
    v_total_ai_cost := 0;
    v_ai_calls := 0;
  END;

  BEGIN
    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
    INTO v_by_model
    FROM (
      SELECT
        generator_model AS model,
        count(*) AS calls,
        round(COALESCE(sum(cost_eur), 0)::numeric, 4) AS cost_eur,
        round(COALESCE(avg(latency_ms), 0)::numeric, 1) AS avg_latency_ms
      FROM public.ai_generations
      WHERE created_at > now() - interval '24 hours'
      GROUP BY generator_model
      ORDER BY COALESCE(sum(cost_eur), 0) DESC
    ) t;
  EXCEPTION WHEN OTHERS THEN
    v_by_model := '[]'::jsonb;
  END;

  -- Auto-heal stats 24h
  BEGIN
    SELECT
      count(*),
      count(*) FILTER (WHERE result_status = 'success')
    INTO v_auto_heal_24h, v_auto_heal_success_24h
    FROM public.auto_heal_log
    WHERE created_at > now() - interval '24 hours';
  EXCEPTION WHEN OTHERS THEN
    v_auto_heal_24h := 0;
    v_auto_heal_success_24h := 0;
  END;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_waves
  FROM (
    SELECT
      id, name, status,
      target_count, seeded_count, completed_count,
      published_count, blocked_count, failed_count,
      max_concurrent, started_at, finished_at
    FROM public.production_waves
    ORDER BY created_at DESC
    LIMIT 20
  ) t;

  RETURN jsonb_build_object(
    'ok', true,
    'waves_total', v_total_waves,
    'waves_active', v_active_waves,
    'items_total', v_total_items,
    'published_total', v_published,
    'blocked_total', v_blocked,
    'publish_rate_pct',
      CASE WHEN v_total_items > 0
      THEN round(v_published::numeric / v_total_items * 100, 1)
      ELSE 0 END,
    'block_rate_pct',
      CASE WHEN v_total_items > 0
      THEN round(v_blocked::numeric / v_total_items * 100, 1)
      ELSE 0 END,
    'packages_building', v_building_packages,
    'packages_queued', v_queued_packages,
    'pending_jobs', v_pending_jobs,
    'failed_jobs_1h', v_failed_jobs_1h,
    'ai_cost_24h_eur', round(COALESCE(v_total_ai_cost, 0), 4),
    'ai_calls_24h', v_ai_calls,
    'auto_heal_24h', v_auto_heal_24h,
    'auto_heal_success_24h', v_auto_heal_success_24h,
    'model_usage', v_by_model,
    'waves', v_waves
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_factory_executive_report() TO service_role;
