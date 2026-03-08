-- Factory Intake Queue
CREATE TABLE IF NOT EXISTS public.factory_intake_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id uuid NOT NULL,
  intake_status text NOT NULL DEFAULT 'detected',
  detected_at timestamptz NOT NULL DEFAULT now(),
  evaluated_at timestamptz,
  readiness_snapshot jsonb,
  priority_score numeric(10,2),
  planned_wave_id uuid,
  planning_notes jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (curriculum_id)
);

ALTER TABLE public.factory_intake_queue ENABLE ROW LEVEL SECURITY;

-- Factory Autonomy Policies
CREATE TABLE IF NOT EXISTS public.factory_autonomy_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key text NOT NULL UNIQUE,
  is_enabled boolean NOT NULL DEFAULT true,
  auto_detect boolean NOT NULL DEFAULT true,
  auto_plan boolean NOT NULL DEFAULT true,
  auto_activate_wave boolean NOT NULL DEFAULT true,
  auto_publish boolean NOT NULL DEFAULT true,
  canary_first boolean NOT NULL DEFAULT true,
  max_new_curricula_per_day int NOT NULL DEFAULT 20,
  max_auto_wave_size int NOT NULL DEFAULT 20,
  preferred_track text DEFAULT 'AUSBILDUNG_VOLL',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.factory_autonomy_policies ENABLE ROW LEVEL SECURITY;

INSERT INTO public.factory_autonomy_policies (
  policy_key, is_enabled, auto_detect, auto_plan, auto_activate_wave,
  auto_publish, canary_first, max_new_curricula_per_day, max_auto_wave_size, preferred_track
) VALUES (
  'factory_default', true, true, true, true, true, true, 20, 20, 'AUSBILDUNG_VOLL'
) ON CONFLICT (policy_key) DO NOTHING;

-- Detection RPC
CREATE OR REPLACE FUNCTION public.detect_ready_curricula_for_factory(
  p_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted int := 0;
BEGIN
  WITH ready AS (
    SELECT rc.curriculum_id
    FROM public.get_ready_curricula(p_limit) rc
    WHERE NOT EXISTS (
      SELECT 1 FROM public.factory_intake_queue fiq
      WHERE fiq.curriculum_id = rc.curriculum_id
    )
  ),
  ins AS (
    INSERT INTO public.factory_intake_queue (curriculum_id, intake_status, detected_at)
    SELECT curriculum_id, 'detected', now()
    FROM ready
    RETURNING id
  )
  SELECT count(*) INTO v_inserted FROM ins;

  RETURN jsonb_build_object('ok', true, 'inserted', v_inserted);
END;
$$;

GRANT EXECUTE ON FUNCTION public.detect_ready_curricula_for_factory(int) TO service_role;

-- Evaluation RPC
CREATE OR REPLACE FUNCTION public.evaluate_factory_intake_items(
  p_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  v_readiness jsonb;
  v_priority numeric;
  v_done int := 0;
BEGIN
  FOR rec IN
    SELECT fiq.id, fiq.curriculum_id
    FROM public.factory_intake_queue fiq
    WHERE fiq.intake_status = 'detected'
    ORDER BY fiq.detected_at ASC
    LIMIT p_limit
  LOOP
    v_readiness := public.check_curriculum_readiness(rec.curriculum_id);

    v_priority :=
      COALESCE((v_readiness->>'market_score')::numeric, 0) * 0.7 +
      COALESCE((v_readiness->>'competencies')::numeric, 0) * 0.2 +
      COALESCE((v_readiness->>'blueprints')::numeric, 0) * 0.1;

    UPDATE public.factory_intake_queue
    SET
      intake_status = CASE
        WHEN COALESCE((v_readiness->>'ready')::boolean, false) THEN 'evaluated'
        ELSE 'rejected'
      END,
      evaluated_at = now(),
      readiness_snapshot = v_readiness,
      priority_score = v_priority,
      updated_at = now()
    WHERE id = rec.id;

    v_done := v_done + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'evaluated', v_done);
END;
$$;

GRANT EXECUTE ON FUNCTION public.evaluate_factory_intake_items(int) TO service_role;

-- Auto-Planning RPC
CREATE OR REPLACE FUNCTION public.plan_factory_wave_from_intake(
  p_limit int DEFAULT 20,
  p_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wave_id uuid;
  v_wave_name text;
  v_count int := 0;
  v_available int := 0;
BEGIN
  SELECT count(*) INTO v_available
  FROM public.factory_intake_queue
  WHERE intake_status = 'evaluated' AND planned_wave_id IS NULL;

  IF v_available = 0 THEN
    RETURN jsonb_build_object('ok', true, 'planned_items', 0, 'reason', 'no_evaluated_items');
  END IF;

  v_wave_name := COALESCE(p_name, 'AutoWave ' || to_char(now(), 'YYYY-MM-DD HH24:MI'));

  INSERT INTO public.production_waves (
    name, status, track, target_count, max_concurrent, meta
  ) VALUES (
    v_wave_name, 'draft', 'AUSBILDUNG_VOLL', p_limit,
    LEAST(10, GREATEST(3, p_limit / 2)),
    jsonb_build_object('source', 'autonomous_factory', 'planned_at', now())
  )
  RETURNING id INTO v_wave_id;

  WITH picked AS (
    SELECT fiq.id, fiq.curriculum_id, fiq.priority_score
    FROM public.factory_intake_queue fiq
    WHERE fiq.intake_status = 'evaluated' AND fiq.planned_wave_id IS NULL
    ORDER BY fiq.priority_score DESC NULLS LAST, fiq.detected_at ASC
    LIMIT p_limit
  )
  INSERT INTO public.production_wave_items (wave_id, curriculum_id, status, priority)
  SELECT v_wave_id, p.curriculum_id, 'pending', COALESCE(ROUND(p.priority_score), 0)::int
  FROM picked p;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.factory_intake_queue fiq
  SET intake_status = 'planned', planned_wave_id = v_wave_id, updated_at = now()
  WHERE fiq.curriculum_id IN (
    SELECT wi.curriculum_id FROM public.production_wave_items wi WHERE wi.wave_id = v_wave_id
  );

  UPDATE public.production_waves
  SET seeded_count = v_count, target_count = v_count
  WHERE id = v_wave_id;

  RETURN jsonb_build_object(
    'ok', true, 'wave_id', v_wave_id, 'wave_name', v_wave_name, 'planned_items', v_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.plan_factory_wave_from_intake(int, text) TO service_role;

-- Update executive report with intake KPIs
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
  v_intake_detected int := 0;
  v_intake_evaluated int := 0;
  v_intake_planned int := 0;
  v_intake_rejected int := 0;
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

  SELECT count(*) INTO v_curricula_enriched FROM public.curricula WHERE enrichment_progress >= 100;
  SELECT count(*) INTO v_curricula_ready FROM public.get_ready_curricula(10000);

  -- Intake KPIs
  SELECT
    count(*) FILTER (WHERE intake_status = 'detected'),
    count(*) FILTER (WHERE intake_status = 'evaluated'),
    count(*) FILTER (WHERE intake_status = 'planned'),
    count(*) FILTER (WHERE intake_status = 'rejected')
  INTO v_intake_detected, v_intake_evaluated, v_intake_planned, v_intake_rejected
  FROM public.factory_intake_queue;

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
    'intake_detected', v_intake_detected,
    'intake_evaluated', v_intake_evaluated,
    'intake_planned', v_intake_planned,
    'intake_rejected', v_intake_rejected,
    'waves', v_waves
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_factory_executive_report() TO service_role;