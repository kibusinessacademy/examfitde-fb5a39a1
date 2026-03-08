CREATE OR REPLACE FUNCTION public.check_curriculum_readiness(
  p_curriculum_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curriculum record;
  v_topics int := 0;
  v_learning_fields int := 0;
  v_competencies int := 0;
  v_blueprints int := 0;
  v_market_score numeric := 0;
  v_enrichment numeric := 0;
  v_ready boolean := false;
BEGIN
  SELECT *
  INTO v_curriculum
  FROM public.curricula
  WHERE id = p_curriculum_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'curriculum_not_found');
  END IF;

  v_enrichment := COALESCE(v_curriculum.enrichment_progress, 0);

  SELECT count(*) INTO v_topics
  FROM public.curriculum_topics
  WHERE certification_id = v_curriculum.certification_id;

  SELECT count(*) INTO v_learning_fields
  FROM public.learning_fields
  WHERE curriculum_id = p_curriculum_id;

  SELECT count(*) INTO v_competencies
  FROM public.competencies
  WHERE curriculum_id = p_curriculum_id;

  SELECT count(*) INTO v_blueprints
  FROM public.question_blueprints
  WHERE curriculum_id = p_curriculum_id;

  BEGIN
    SELECT COALESCE(avg(fit_score), 0)
    INTO v_market_score
    FROM public.beruf_market_data
    WHERE beruf_id = v_curriculum.beruf_id;
  EXCEPTION WHEN undefined_table THEN
    v_market_score := 0;
  END;

  v_ready :=
    v_enrichment >= 100
    AND v_learning_fields >= 8
    AND v_competencies >= 40
    AND v_blueprints >= 50
    AND v_topics >= 5;

  RETURN jsonb_build_object(
    'ok', true,
    'curriculum_id', p_curriculum_id,
    'enrichment_progress', v_enrichment,
    'topics', v_topics,
    'learning_fields', v_learning_fields,
    'competencies', v_competencies,
    'blueprints', v_blueprints,
    'market_score', v_market_score,
    'ready', v_ready
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_curriculum_readiness(uuid) TO service_role;

-- Batch readiness check for seed endpoint
CREATE OR REPLACE FUNCTION public.get_ready_curricula(
  p_limit int DEFAULT 100
)
RETURNS TABLE (
  curriculum_id uuid,
  title text,
  track text,
  enrichment_progress numeric,
  learning_fields bigint,
  competencies bigint,
  blueprints bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.title,
    c.track,
    c.enrichment_progress,
    count(DISTINCT lf.id) AS learning_fields,
    count(DISTINCT co.id) AS competencies,
    count(DISTINCT qb.id) AS blueprints
  FROM public.curricula c
  LEFT JOIN public.learning_fields lf ON lf.curriculum_id = c.id
  LEFT JOIN public.competencies co ON co.curriculum_id = c.id
  LEFT JOIN public.question_blueprints qb ON qb.curriculum_id = c.id
  WHERE c.enrichment_progress >= 100
  GROUP BY c.id
  HAVING
    count(DISTINCT lf.id) >= 8
    AND count(DISTINCT co.id) >= 40
    AND count(DISTINCT qb.id) >= 50
  ORDER BY c.created_at
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ready_curricula(int) TO service_role;

-- Update executive report to include readiness counts
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
  v_model_usage jsonb := '[]'::jsonb;
  v_waves jsonb := '[]'::jsonb;
  v_auto_heal_24h int := 0;
  v_auto_heal_success_24h int := 0;
  v_curricula_enriched int := 0;
  v_curricula_ready int := 0;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE status = 'active')
  INTO v_total_waves, v_active_waves
  FROM public.production_waves;

  SELECT count(*),
         count(*) FILTER (WHERE status = 'published'),
         count(*) FILTER (WHERE status = 'blocked')
  INTO v_total_items, v_published, v_blocked
  FROM public.production_wave_items;

  SELECT count(*) INTO v_building_packages FROM public.course_packages WHERE status = 'building';
  SELECT count(*) INTO v_queued_packages FROM public.course_packages WHERE status = 'queued';
  SELECT count(*) INTO v_pending_jobs FROM public.job_queue WHERE status IN ('pending','queued','processing');
  SELECT count(*) INTO v_failed_jobs_1h FROM public.job_queue WHERE status = 'failed' AND updated_at > now() - interval '1 hour';

  -- Curricula readiness
  SELECT count(*) INTO v_curricula_enriched FROM public.curricula WHERE enrichment_progress >= 100;
  SELECT count(*) INTO v_curricula_ready FROM public.get_ready_curricula(10000);

  BEGIN
    SELECT COALESCE(sum(cost_eur), 0), count(*)
    INTO v_total_ai_cost, v_ai_calls
    FROM public.ai_generations
    WHERE created_at > now() - interval '24 hours';
  EXCEPTION WHEN OTHERS THEN
    v_total_ai_cost := 0; v_ai_calls := 0;
  END;

  BEGIN
    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
    INTO v_model_usage
    FROM (
      SELECT generator_model AS model, count(*) AS calls,
        round(COALESCE(sum(cost_eur),0)::numeric, 4) AS cost_eur,
        round(avg(latency_ms)::numeric, 0) AS avg_latency_ms
      FROM public.ai_generations
      WHERE created_at > now() - interval '24 hours'
      GROUP BY generator_model
      ORDER BY sum(cost_eur) DESC NULLS LAST
    ) t;
  EXCEPTION WHEN OTHERS THEN
    v_model_usage := '[]'::jsonb;
  END;

  BEGIN
    SELECT count(*), count(*) FILTER (WHERE result_status = 'success')
    INTO v_auto_heal_24h, v_auto_heal_success_24h
    FROM public.auto_heal_log
    WHERE created_at > now() - interval '24 hours';
  EXCEPTION WHEN OTHERS THEN
    v_auto_heal_24h := 0; v_auto_heal_success_24h := 0;
  END;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_waves
  FROM (
    SELECT id, name, status, meta,
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
      CASE WHEN v_total_items > 0 THEN round(v_published::numeric / v_total_items * 100, 1) ELSE 0 END,
    'block_rate_pct',
      CASE WHEN v_total_items > 0 THEN round(v_blocked::numeric / v_total_items * 100, 1) ELSE 0 END,
    'packages_building', v_building_packages,
    'packages_queued', v_queued_packages,
    'pending_jobs', v_pending_jobs,
    'failed_jobs_1h', v_failed_jobs_1h,
    'ai_cost_24h_eur', round(COALESCE(v_total_ai_cost, 0), 4),
    'ai_calls_24h', v_ai_calls,
    'model_usage', v_model_usage,
    'auto_heal_24h', v_auto_heal_24h,
    'auto_heal_success_24h', v_auto_heal_success_24h,
    'curricula_enriched', v_curricula_enriched,
    'curricula_ready', v_curricula_ready,
    'waves', v_waves
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_factory_executive_report() TO service_role;