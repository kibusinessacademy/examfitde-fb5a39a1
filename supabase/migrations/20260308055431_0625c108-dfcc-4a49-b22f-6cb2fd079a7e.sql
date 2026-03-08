
CREATE OR REPLACE FUNCTION public.get_wave_kpi_report(p_wave_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wave record;
  v_total_items int := 0;
  v_published int := 0;
  v_blocked int := 0;
  v_qg_passed int := 0;
  v_qg_failed int := 0;
  v_pending int := 0;
  v_queued int := 0;
  v_building int := 0;
  v_avg_duration_min numeric := 0;
  v_median_duration_min numeric := 0;
  v_total_jobs int := 0;
  v_failed_jobs int := 0;
  v_done_jobs int := 0;
  v_active_jobs int := 0;
  v_total_ai_cost numeric := 0;
  v_ai_calls int := 0;
  v_by_model jsonb := '[]'::jsonb;
  v_by_job_type jsonb := '[]'::jsonb;
  v_auto_heal_runs int := 0;
  v_auto_heal_success int := 0;
BEGIN
  SELECT *
  INTO v_wave
  FROM public.production_waves
  WHERE id = p_wave_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wave_not_found');
  END IF;

  -- Item counts by status
  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'published'),
    count(*) FILTER (WHERE status = 'blocked'),
    count(*) FILTER (WHERE status = 'quality_gate_passed'),
    count(*) FILTER (WHERE status = 'quality_gate_failed'),
    count(*) FILTER (WHERE status = 'pending'),
    count(*) FILTER (WHERE status = 'queued'),
    count(*) FILTER (WHERE status = 'building')
  INTO v_total_items, v_published, v_blocked, v_qg_passed, v_qg_failed, v_pending, v_queued, v_building
  FROM public.production_wave_items
  WHERE wave_id = p_wave_id;

  -- Duration stats
  SELECT
    COALESCE(avg(extract(epoch from (finished_at - started_at)) / 60.0), 0),
    COALESCE(percentile_cont(0.5) WITHIN GROUP (
      ORDER BY extract(epoch from (finished_at - started_at)) / 60.0
    ), 0)
  INTO v_avg_duration_min, v_median_duration_min
  FROM public.production_wave_items
  WHERE wave_id = p_wave_id
    AND started_at IS NOT NULL
    AND finished_at IS NOT NULL;

  -- Job stats
  SELECT
    count(*),
    count(*) FILTER (WHERE jq.status = 'failed'),
    count(*) FILTER (WHERE jq.status = 'done'),
    count(*) FILTER (WHERE jq.status IN ('pending','queued','processing'))
  INTO v_total_jobs, v_failed_jobs, v_done_jobs, v_active_jobs
  FROM public.job_queue jq
  JOIN public.production_wave_items wi ON wi.package_id = jq.package_id
  WHERE wi.wave_id = p_wave_id;

  -- AI cost via ai_generations linked through entity_id = package_id
  BEGIN
    SELECT
      COALESCE(sum(ag.cost_eur), 0),
      count(*)
    INTO v_total_ai_cost, v_ai_calls
    FROM public.ai_generations ag
    JOIN public.production_wave_items wi ON wi.package_id::text = ag.entity_id
    WHERE wi.wave_id = p_wave_id
      AND ag.entity_type = 'package';
  EXCEPTION WHEN OTHERS THEN
    v_total_ai_cost := 0;
    v_ai_calls := 0;
  END;

  -- Cost by model
  BEGIN
    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
    INTO v_by_model
    FROM (
      SELECT
        ag.generator_model AS model,
        count(*) AS calls,
        round(COALESCE(sum(ag.cost_eur), 0)::numeric, 4) AS cost_eur,
        round(COALESCE(avg(ag.latency_ms), 0)::numeric, 1) AS avg_latency_ms
      FROM public.ai_generations ag
      JOIN public.production_wave_items wi ON wi.package_id::text = ag.entity_id
      WHERE wi.wave_id = p_wave_id
        AND ag.entity_type = 'package'
      GROUP BY ag.generator_model
      ORDER BY COALESCE(sum(ag.cost_eur), 0) DESC
    ) t;
  EXCEPTION WHEN OTHERS THEN
    v_by_model := '[]'::jsonb;
  END;

  -- Jobs by type
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_by_job_type
  FROM (
    SELECT
      jq.job_type,
      count(*) AS total,
      count(*) FILTER (WHERE jq.status = 'done') AS done,
      count(*) FILTER (WHERE jq.status = 'failed') AS failed,
      count(*) FILTER (WHERE jq.status IN ('pending','queued','processing')) AS active
    FROM public.job_queue jq
    JOIN public.production_wave_items wi ON wi.package_id = jq.package_id
    WHERE wi.wave_id = p_wave_id
    GROUP BY jq.job_type
    ORDER BY count(*) DESC
  ) t;

  -- Auto-heal stats
  BEGIN
    SELECT
      count(*),
      count(*) FILTER (WHERE result_status = 'success')
    INTO v_auto_heal_runs, v_auto_heal_success
    FROM public.auto_heal_log ah
    WHERE ah.target_id IN (
      SELECT wi.package_id::text FROM public.production_wave_items wi WHERE wi.wave_id = p_wave_id
    );
  EXCEPTION WHEN OTHERS THEN
    v_auto_heal_runs := 0;
    v_auto_heal_success := 0;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'wave_id', p_wave_id,
    'wave_name', v_wave.name,
    'wave_status', v_wave.status,
    'total_items', v_total_items,
    'published', v_published,
    'blocked', v_blocked,
    'quality_gate_passed', v_qg_passed,
    'quality_gate_failed', v_qg_failed,
    'pending', v_pending,
    'queued', v_queued,
    'building', v_building,
    'publish_rate_pct', CASE WHEN v_total_items > 0 THEN round(v_published::numeric / v_total_items * 100, 1) ELSE 0 END,
    'block_rate_pct', CASE WHEN v_total_items > 0 THEN round(v_blocked::numeric / v_total_items * 100, 1) ELSE 0 END,
    'avg_duration_min', round(v_avg_duration_min, 1),
    'median_duration_min', round(v_median_duration_min, 1),
    'total_jobs', v_total_jobs,
    'failed_jobs', v_failed_jobs,
    'done_jobs', v_done_jobs,
    'active_jobs', v_active_jobs,
    'job_failure_rate_pct', CASE WHEN v_total_jobs > 0 THEN round(v_failed_jobs::numeric / v_total_jobs * 100, 1) ELSE 0 END,
    'total_ai_cost_eur', round(v_total_ai_cost, 4),
    'ai_calls', v_ai_calls,
    'avg_cost_per_item_eur', CASE WHEN v_total_items > 0 THEN round(v_total_ai_cost / v_total_items, 4) ELSE 0 END,
    'auto_heal_runs', v_auto_heal_runs,
    'auto_heal_success', v_auto_heal_success,
    'by_model', v_by_model,
    'by_job_type', v_by_job_type
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_wave_kpi_report(uuid) TO service_role;
