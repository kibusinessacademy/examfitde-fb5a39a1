
-- ============================================================
-- 1. SIGNAL RUNS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.curriculum_signal_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  processed_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

-- ============================================================
-- 2. RAW MARKET SIGNALS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.curriculum_market_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_catalog_id uuid REFERENCES public.qualification_catalog(id) ON DELETE CASCADE,
  curriculum_id uuid REFERENCES public.curricula(id) ON DELETE CASCADE,
  signal_source text NOT NULL,
  signal_key text NOT NULL,
  signal_value numeric NOT NULL DEFAULT 0,
  signal_unit text,
  signal_weight numeric NOT NULL DEFAULT 1,
  observed_at timestamptz NOT NULL DEFAULT now(),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_curriculum_market_signals_lookup
  ON public.curriculum_market_signals (qualification_catalog_id, curriculum_id, signal_source, signal_key);

-- ============================================================
-- 3. AGGREGATED INTELLIGENCE SCORES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.curriculum_intelligence_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_catalog_id uuid REFERENCES public.qualification_catalog(id) ON DELETE CASCADE,
  curriculum_id uuid REFERENCES public.curricula(id) ON DELETE CASCADE,
  demand_score numeric NOT NULL DEFAULT 0,
  monetization_score numeric NOT NULL DEFAULT 0,
  competition_gap_score numeric NOT NULL DEFAULT 0,
  exam_relevance_score numeric NOT NULL DEFAULT 0,
  readiness_score numeric NOT NULL DEFAULT 0,
  strategic_fit_score numeric NOT NULL DEFAULT 0,
  overall_priority_score numeric NOT NULL DEFAULT 0,
  recommendation text NOT NULL DEFAULT 'hold',
  reasoning jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_curriculum_intelligence_scores_qc
  ON public.curriculum_intelligence_scores (qualification_catalog_id);

-- ============================================================
-- 4. PRIORITY RECOMMENDATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.curriculum_priority_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_catalog_id uuid REFERENCES public.qualification_catalog(id) ON DELETE CASCADE,
  curriculum_id uuid REFERENCES public.curricula(id) ON DELETE CASCADE,
  wave_status text NOT NULL DEFAULT 'unassigned',
  recommended_track text NOT NULL DEFAULT 'AUSBILDUNG_VOLL',
  recommended_priority integer NOT NULL DEFAULT 5,
  recommended_for_wave boolean NOT NULL DEFAULT false,
  blocking_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  score_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_curriculum_priority_recommendations_qc
  ON public.curriculum_priority_recommendations (qualification_catalog_id);

-- ============================================================
-- 5. HELPER: latest signal
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_latest_signal_value(
  p_qualification_catalog_id uuid,
  p_signal_key text
)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT cms.signal_value
  FROM public.curriculum_market_signals cms
  WHERE cms.qualification_catalog_id = p_qualification_catalog_id
    AND cms.signal_key = p_signal_key
  ORDER BY cms.observed_at DESC, cms.created_at DESC
  LIMIT 1
$$;

-- ============================================================
-- 6. UPSERT SIGNAL
-- ============================================================

CREATE OR REPLACE FUNCTION public.upsert_curriculum_market_signal(
  p_qualification_catalog_id uuid,
  p_curriculum_id uuid,
  p_signal_source text,
  p_signal_key text,
  p_signal_value numeric,
  p_signal_unit text DEFAULT NULL,
  p_signal_weight numeric DEFAULT 1,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.curriculum_market_signals (
    qualification_catalog_id, curriculum_id, signal_source,
    signal_key, signal_value, signal_unit, signal_weight, meta
  )
  VALUES (
    p_qualification_catalog_id, p_curriculum_id, p_signal_source,
    p_signal_key, p_signal_value, p_signal_unit,
    coalesce(p_signal_weight, 1), coalesce(p_meta, '{}'::jsonb)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ============================================================
-- 7. COMPUTE INTELLIGENCE SCORE
-- ============================================================

CREATE OR REPLACE FUNCTION public.compute_curriculum_intelligence_score(
  p_qualification_catalog_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qc public.qualification_catalog%ROWTYPE;
  v_draft record;
  v_demand numeric := 0;
  v_monetization numeric := 0;
  v_competition_gap numeric := 0;
  v_exam_relevance numeric := 0;
  v_readiness numeric := 0;
  v_strategic_fit numeric := 0;
  v_overall numeric := 0;
  v_recommendation text := 'hold';
BEGIN
  SELECT * INTO v_qc
  FROM public.qualification_catalog
  WHERE id = p_qualification_catalog_id;

  IF v_qc.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'qualification_not_found');
  END IF;

  SELECT max(d.readiness_score) AS readiness_score
  INTO v_draft
  FROM public.qualification_curriculum_drafts d
  WHERE d.qualification_catalog_id = p_qualification_catalog_id;

  v_demand := coalesce(public.get_latest_signal_value(p_qualification_catalog_id, 'search_volume_score'), 0);
  v_monetization := coalesce(public.get_latest_signal_value(p_qualification_catalog_id, 'monetization_score'), 0);
  v_competition_gap := coalesce(public.get_latest_signal_value(p_qualification_catalog_id, 'competition_gap_score'), 0);
  v_exam_relevance := coalesce(public.get_latest_signal_value(p_qualification_catalog_id, 'exam_relevance_score'), 0);
  v_readiness := coalesce(v_draft.readiness_score, 0);

  v_strategic_fit :=
    CASE
      WHEN v_qc.award_type IN ('fachwirt','betriebswirt','meister','bilanzbuchhalter') THEN 85
      WHEN v_qc.award_type IN ('controller','fachkaufmann','ada') THEN 70
      ELSE 50
    END;

  v_overall :=
      (v_demand * 0.25)
    + (v_monetization * 0.20)
    + (v_competition_gap * 0.15)
    + (v_exam_relevance * 0.20)
    + (v_readiness * 0.10)
    + (v_strategic_fit * 0.10);

  v_recommendation :=
    CASE
      WHEN v_overall >= 80 THEN 'build_now'
      WHEN v_overall >= 65 THEN 'build_next_wave'
      WHEN v_overall >= 45 THEN 'observe'
      ELSE 'hold'
    END;

  INSERT INTO public.curriculum_intelligence_scores (
    qualification_catalog_id, curriculum_id,
    demand_score, monetization_score, competition_gap_score,
    exam_relevance_score, readiness_score, strategic_fit_score,
    overall_priority_score, recommendation, reasoning,
    last_computed_at, updated_at
  )
  VALUES (
    p_qualification_catalog_id, NULL,
    v_demand, v_monetization, v_competition_gap,
    v_exam_relevance, v_readiness, v_strategic_fit,
    v_overall, v_recommendation,
    jsonb_build_object(
      'award_type', v_qc.award_type,
      'provider_family', v_qc.provider_family,
      'components', jsonb_build_object(
        'demand', v_demand, 'monetization', v_monetization,
        'competition_gap', v_competition_gap, 'exam_relevance', v_exam_relevance,
        'readiness', v_readiness, 'strategic_fit', v_strategic_fit
      )
    ),
    now(), now()
  )
  ON CONFLICT (qualification_catalog_id)
  DO UPDATE SET
    demand_score = excluded.demand_score,
    monetization_score = excluded.monetization_score,
    competition_gap_score = excluded.competition_gap_score,
    exam_relevance_score = excluded.exam_relevance_score,
    readiness_score = excluded.readiness_score,
    strategic_fit_score = excluded.strategic_fit_score,
    overall_priority_score = excluded.overall_priority_score,
    recommendation = excluded.recommendation,
    reasoning = excluded.reasoning,
    last_computed_at = now(),
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'qualification_catalog_id', p_qualification_catalog_id,
    'overall_priority_score', round(v_overall, 2),
    'recommendation', v_recommendation
  );
END;
$$;

-- ============================================================
-- 8. SYNC PRIORITY RECOMMENDATIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_curriculum_priority_recommendations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT * FROM public.curriculum_intelligence_scores
  LOOP
    INSERT INTO public.curriculum_priority_recommendations (
      qualification_catalog_id, curriculum_id, wave_status,
      recommended_track, recommended_priority, recommended_for_wave,
      blocking_reasons, recommendations, score_snapshot, updated_at
    )
    VALUES (
      v_row.qualification_catalog_id, v_row.curriculum_id,
      CASE WHEN v_row.recommendation IN ('build_now','build_next_wave') THEN 'recommended' ELSE 'unassigned' END,
      'AUSBILDUNG_VOLL',
      LEAST(10, GREATEST(1, round(v_row.overall_priority_score / 10))),
      v_row.recommendation IN ('build_now','build_next_wave'),
      CASE WHEN v_row.readiness_score < 60 THEN jsonb_build_array('low_readiness') ELSE '[]'::jsonb END,
      jsonb_build_array(v_row.recommendation),
      jsonb_build_object('overall_priority_score', v_row.overall_priority_score, 'recommendation', v_row.recommendation),
      now()
    )
    ON CONFLICT (qualification_catalog_id)
    DO UPDATE SET
      recommended_priority = excluded.recommended_priority,
      recommended_for_wave = excluded.recommended_for_wave,
      wave_status = excluded.wave_status,
      blocking_reasons = excluded.blocking_reasons,
      recommendations = excluded.recommendations,
      score_snapshot = excluded.score_snapshot,
      updated_at = now();

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'synced', v_count);
END;
$$;
