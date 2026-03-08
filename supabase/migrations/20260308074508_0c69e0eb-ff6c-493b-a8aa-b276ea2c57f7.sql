
-- 1. REVENUE RUNS
CREATE TABLE IF NOT EXISTS public.curriculum_revenue_runs (
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

-- Use trigger instead of CHECK for status validation
CREATE OR REPLACE FUNCTION public.trg_validate_curriculum_revenue_runs_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('running','done','failed') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_curriculum_revenue_runs_status ON public.curriculum_revenue_runs;
CREATE TRIGGER validate_curriculum_revenue_runs_status
  BEFORE INSERT OR UPDATE ON public.curriculum_revenue_runs
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_curriculum_revenue_runs_status();

-- 2. REVENUE SIGNALS
CREATE TABLE IF NOT EXISTS public.curriculum_revenue_signals (
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

CREATE INDEX IF NOT EXISTS idx_curriculum_revenue_signals_lookup
  ON public.curriculum_revenue_signals (qualification_catalog_id, curriculum_id, signal_source, signal_key, observed_at DESC);

-- 3. GTM SCORES
CREATE TABLE IF NOT EXISTS public.curriculum_gtm_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_catalog_id uuid REFERENCES public.qualification_catalog(id) ON DELETE CASCADE,
  curriculum_id uuid REFERENCES public.curricula(id) ON DELETE CASCADE,
  b2c_revenue_score numeric NOT NULL DEFAULT 0,
  b2b_revenue_score numeric NOT NULL DEFAULT 0,
  seo_score numeric NOT NULL DEFAULT 0,
  affiliate_score numeric NOT NULL DEFAULT 0,
  conversion_score numeric NOT NULL DEFAULT 0,
  price_power_score numeric NOT NULL DEFAULT 0,
  content_leverage_score numeric NOT NULL DEFAULT 0,
  overall_gtm_score numeric NOT NULL DEFAULT 0,
  primary_channel text NOT NULL DEFAULT 'b2c',
  launch_recommendation text NOT NULL DEFAULT 'defer',
  reasoning jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_curriculum_gtm_scores_qc
  ON public.curriculum_gtm_scores (qualification_catalog_id);

-- Validation triggers for GTM scores
CREATE OR REPLACE FUNCTION public.trg_validate_curriculum_gtm_scores()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.primary_channel NOT IN ('b2c','b2b','seo','affiliate','hybrid') THEN
    RAISE EXCEPTION 'Invalid primary_channel: %', NEW.primary_channel;
  END IF;
  IF NEW.launch_recommendation NOT IN ('launch_now','prepare_launch','seo_first','b2b_first','affiliate_first','defer') THEN
    RAISE EXCEPTION 'Invalid launch_recommendation: %', NEW.launch_recommendation;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_curriculum_gtm_scores ON public.curriculum_gtm_scores;
CREATE TRIGGER validate_curriculum_gtm_scores
  BEFORE INSERT OR UPDATE ON public.curriculum_gtm_scores
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_curriculum_gtm_scores();

-- 4. LAUNCH RECOMMENDATIONS
CREATE TABLE IF NOT EXISTS public.curriculum_launch_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qualification_catalog_id uuid REFERENCES public.qualification_catalog(id) ON DELETE CASCADE,
  curriculum_id uuid REFERENCES public.curricula(id) ON DELETE CASCADE,
  launch_status text NOT NULL DEFAULT 'planned',
  primary_channel text NOT NULL DEFAULT 'b2c',
  campaign_priority integer NOT NULL DEFAULT 5,
  offer_type text NOT NULL DEFAULT 'standard_course',
  recommended_price_tier text NOT NULL DEFAULT 'mid',
  seo_slug text,
  recommended_assets jsonb NOT NULL DEFAULT '[]'::jsonb,
  blocking_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  score_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_curriculum_launch_recommendations_qc
  ON public.curriculum_launch_recommendations (qualification_catalog_id);

-- Validation trigger for launch recommendations
CREATE OR REPLACE FUNCTION public.trg_validate_curriculum_launch_recommendations()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.launch_status NOT IN ('planned','ready','in_campaign','launched','blocked','ignored') THEN
    RAISE EXCEPTION 'Invalid launch_status: %', NEW.launch_status;
  END IF;
  IF NEW.offer_type NOT IN ('standard_course','premium_exam_trainer','b2b_license','seo_leadmagnet','affiliate_offer','hybrid_bundle') THEN
    RAISE EXCEPTION 'Invalid offer_type: %', NEW.offer_type;
  END IF;
  IF NEW.recommended_price_tier NOT IN ('low','mid','high','premium') THEN
    RAISE EXCEPTION 'Invalid recommended_price_tier: %', NEW.recommended_price_tier;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_curriculum_launch_recommendations ON public.curriculum_launch_recommendations;
CREATE TRIGGER validate_curriculum_launch_recommendations
  BEFORE INSERT OR UPDATE ON public.curriculum_launch_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.trg_validate_curriculum_launch_recommendations();

-- 5. HELPER: latest revenue signal
CREATE OR REPLACE FUNCTION public.get_latest_revenue_signal_value(
  p_qualification_catalog_id uuid,
  p_signal_key text
)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT crs.signal_value
  FROM public.curriculum_revenue_signals crs
  WHERE crs.qualification_catalog_id = p_qualification_catalog_id
    AND crs.signal_key = p_signal_key
  ORDER BY crs.observed_at DESC, crs.created_at DESC
  LIMIT 1
$$;

-- 6. UPSERT REVENUE SIGNAL
CREATE OR REPLACE FUNCTION public.upsert_curriculum_revenue_signal(
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
  INSERT INTO public.curriculum_revenue_signals (
    qualification_catalog_id, curriculum_id, signal_source, signal_key,
    signal_value, signal_unit, signal_weight, meta
  )
  VALUES (
    p_qualification_catalog_id, p_curriculum_id, p_signal_source, p_signal_key,
    p_signal_value, p_signal_unit, coalesce(p_signal_weight, 1), coalesce(p_meta, '{}'::jsonb)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- 7. COMPUTE GTM SCORE
CREATE OR REPLACE FUNCTION public.compute_curriculum_gtm_score(
  p_qualification_catalog_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qc public.qualification_catalog%ROWTYPE;
  v_intel public.curriculum_intelligence_scores%ROWTYPE;
  v_b2c numeric := 0;
  v_b2b numeric := 0;
  v_seo numeric := 0;
  v_affiliate numeric := 0;
  v_conversion numeric := 0;
  v_price_power numeric := 0;
  v_content_leverage numeric := 0;
  v_overall numeric := 0;
  v_primary_channel text := 'b2c';
  v_launch text := 'defer';
BEGIN
  SELECT * INTO v_qc FROM public.qualification_catalog WHERE id = p_qualification_catalog_id;
  IF v_qc.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'qualification_not_found');
  END IF;

  SELECT * INTO v_intel FROM public.curriculum_intelligence_scores
  WHERE qualification_catalog_id = p_qualification_catalog_id;

  v_b2c := coalesce(public.get_latest_revenue_signal_value(p_qualification_catalog_id, 'b2c_revenue_score'), 0);
  v_b2b := coalesce(public.get_latest_revenue_signal_value(p_qualification_catalog_id, 'b2b_revenue_score'), 0);
  v_seo := coalesce(public.get_latest_revenue_signal_value(p_qualification_catalog_id, 'seo_score'), 0);
  v_affiliate := coalesce(public.get_latest_revenue_signal_value(p_qualification_catalog_id, 'affiliate_score'), 0);
  v_conversion := coalesce(public.get_latest_revenue_signal_value(p_qualification_catalog_id, 'conversion_score'), 0);
  v_price_power := coalesce(public.get_latest_revenue_signal_value(p_qualification_catalog_id, 'price_power_score'), 0);
  v_content_leverage := coalesce(public.get_latest_revenue_signal_value(p_qualification_catalog_id, 'content_leverage_score'), 0);

  v_overall :=
      (v_b2c * 0.22) + (v_b2b * 0.22) + (v_seo * 0.14) + (v_affiliate * 0.08)
    + (v_conversion * 0.14) + (v_price_power * 0.10) + (v_content_leverage * 0.10);

  v_primary_channel :=
    CASE
      WHEN greatest(v_b2c, v_b2b, v_seo, v_affiliate) = v_b2b AND v_b2b >= 70 THEN 'b2b'
      WHEN greatest(v_b2c, v_b2b, v_seo, v_affiliate) = v_seo AND v_seo >= 70 THEN 'seo'
      WHEN greatest(v_b2c, v_b2b, v_seo, v_affiliate) = v_affiliate AND v_affiliate >= 70 THEN 'affiliate'
      WHEN abs(v_b2c - v_b2b) <= 8 AND greatest(v_b2c, v_b2b) >= 70 THEN 'hybrid'
      ELSE 'b2c'
    END;

  v_launch :=
    CASE
      WHEN v_overall >= 82 AND coalesce(v_intel.recommendation, 'hold') IN ('build_now','build_next_wave') THEN 'launch_now'
      WHEN v_primary_channel = 'seo' AND v_seo >= 72 THEN 'seo_first'
      WHEN v_primary_channel = 'b2b' AND v_b2b >= 72 THEN 'b2b_first'
      WHEN v_primary_channel = 'affiliate' AND v_affiliate >= 70 THEN 'affiliate_first'
      WHEN v_overall >= 65 THEN 'prepare_launch'
      ELSE 'defer'
    END;

  INSERT INTO public.curriculum_gtm_scores (
    qualification_catalog_id, curriculum_id,
    b2c_revenue_score, b2b_revenue_score, seo_score, affiliate_score,
    conversion_score, price_power_score, content_leverage_score,
    overall_gtm_score, primary_channel, launch_recommendation, reasoning,
    updated_at, last_computed_at
  )
  VALUES (
    p_qualification_catalog_id, NULL,
    v_b2c, v_b2b, v_seo, v_affiliate,
    v_conversion, v_price_power, v_content_leverage,
    v_overall, v_primary_channel, v_launch,
    jsonb_build_object(
      'award_type', v_qc.award_type,
      'provider_family', v_qc.provider_family,
      'intelligence_recommendation', v_intel.recommendation,
      'components', jsonb_build_object(
        'b2c', v_b2c, 'b2b', v_b2b, 'seo', v_seo, 'affiliate', v_affiliate,
        'conversion', v_conversion, 'price_power', v_price_power, 'content_leverage', v_content_leverage
      )
    ),
    now(), now()
  )
  ON CONFLICT (qualification_catalog_id)
  DO UPDATE SET
    b2c_revenue_score = excluded.b2c_revenue_score,
    b2b_revenue_score = excluded.b2b_revenue_score,
    seo_score = excluded.seo_score,
    affiliate_score = excluded.affiliate_score,
    conversion_score = excluded.conversion_score,
    price_power_score = excluded.price_power_score,
    content_leverage_score = excluded.content_leverage_score,
    overall_gtm_score = excluded.overall_gtm_score,
    primary_channel = excluded.primary_channel,
    launch_recommendation = excluded.launch_recommendation,
    reasoning = excluded.reasoning,
    updated_at = now(),
    last_computed_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'qualification_catalog_id', p_qualification_catalog_id,
    'overall_gtm_score', round(v_overall, 2),
    'primary_channel', v_primary_channel,
    'launch_recommendation', v_launch
  );
END;
$$;

-- 8. SYNC LAUNCH RECOMMENDATIONS
CREATE OR REPLACE FUNCTION public.sync_curriculum_launch_recommendations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
  v_campaign_priority integer;
  v_offer_type text;
  v_price_tier text;
BEGIN
  FOR v_row IN SELECT * FROM public.curriculum_gtm_scores
  LOOP
    v_campaign_priority := LEAST(10, GREATEST(1, round(v_row.overall_gtm_score / 10)));

    v_offer_type :=
      CASE
        WHEN v_row.primary_channel = 'b2b' THEN 'b2b_license'
        WHEN v_row.primary_channel = 'seo' THEN 'seo_leadmagnet'
        WHEN v_row.primary_channel = 'affiliate' THEN 'affiliate_offer'
        WHEN v_row.primary_channel = 'hybrid' THEN 'hybrid_bundle'
        WHEN v_row.overall_gtm_score >= 80 THEN 'premium_exam_trainer'
        ELSE 'standard_course'
      END;

    v_price_tier :=
      CASE
        WHEN v_row.price_power_score >= 85 THEN 'premium'
        WHEN v_row.price_power_score >= 70 THEN 'high'
        WHEN v_row.price_power_score >= 50 THEN 'mid'
        ELSE 'low'
      END;

    INSERT INTO public.curriculum_launch_recommendations (
      qualification_catalog_id, curriculum_id, launch_status, primary_channel,
      campaign_priority, offer_type, recommended_price_tier,
      recommended_assets, blocking_reasons, recommendations, score_snapshot, updated_at
    )
    VALUES (
      v_row.qualification_catalog_id, v_row.curriculum_id,
      CASE WHEN v_row.launch_recommendation = 'defer' THEN 'planned' ELSE 'ready' END,
      v_row.primary_channel, v_campaign_priority, v_offer_type, v_price_tier,
      CASE
        WHEN v_row.primary_channel = 'seo' THEN jsonb_build_array('pillar_page','landing_page','faq_cluster','blog_posts')
        WHEN v_row.primary_channel = 'b2b' THEN jsonb_build_array('sales_onepager','license_page','demo_flow')
        WHEN v_row.primary_channel = 'affiliate' THEN jsonb_build_array('affiliate_page','promo_assets','coupon_flow')
        WHEN v_row.primary_channel = 'hybrid' THEN jsonb_build_array('landing_page','sales_onepager','exam_trainer_offer')
        ELSE jsonb_build_array('landing_page','checkout_offer','email_sequence')
      END,
      CASE WHEN v_row.overall_gtm_score < 50 THEN jsonb_build_array('low_gtm_score') ELSE '[]'::jsonb END,
      jsonb_build_array(v_row.launch_recommendation),
      jsonb_build_object(
        'overall_gtm_score', v_row.overall_gtm_score,
        'primary_channel', v_row.primary_channel,
        'launch_recommendation', v_row.launch_recommendation
      ),
      now()
    )
    ON CONFLICT (qualification_catalog_id)
    DO UPDATE SET
      launch_status = excluded.launch_status,
      primary_channel = excluded.primary_channel,
      campaign_priority = excluded.campaign_priority,
      offer_type = excluded.offer_type,
      recommended_price_tier = excluded.recommended_price_tier,
      recommended_assets = excluded.recommended_assets,
      blocking_reasons = excluded.blocking_reasons,
      recommendations = excluded.recommendations,
      score_snapshot = excluded.score_snapshot,
      updated_at = now();

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'synced', v_count);
END;
$$;

-- RLS
ALTER TABLE public.curriculum_revenue_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curriculum_revenue_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curriculum_gtm_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curriculum_launch_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.curriculum_revenue_runs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.curriculum_revenue_signals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.curriculum_gtm_scores FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.curriculum_launch_recommendations FOR ALL USING (true) WITH CHECK (true);
