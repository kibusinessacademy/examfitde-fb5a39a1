
-- ============================================================
-- Growth Loop System – Tables, Functions, Indexes
-- ============================================================

-- 1. viral_hooks
CREATE TABLE IF NOT EXISTS public.viral_hooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hook_text text NOT NULL,
  category text NOT NULL DEFAULT 'curiosity',
  target_platform text NULL,
  target_persona text NULL,
  performance_score numeric NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  shares integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.viral_hooks ENABLE ROW LEVEL SECURITY;

-- 2. ugc_content
CREATE TABLE IF NOT EXISTS public.ugc_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  content_type text NOT NULL,
  title text NULL,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_share_event_id uuid REFERENCES public.share_events(id) ON DELETE SET NULL,
  source_type text NULL,
  approved boolean NOT NULL DEFAULT false,
  approved_by text NULL,
  approved_at timestamptz NULL,
  rejection_reason text NULL,
  published_url text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ugc_content ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_ugc_content_user ON public.ugc_content(user_id);
CREATE INDEX idx_ugc_content_status ON public.ugc_content(approved, content_type);

-- 3. newsletter_campaigns
CREATE TABLE IF NOT EXISTS public.newsletter_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  content_md text NULL,
  content_html text NULL,
  audience text NOT NULL DEFAULT 'all',
  audience_filter jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  scheduled_at timestamptz NULL,
  sent_at timestamptz NULL,
  recipient_count integer NOT NULL DEFAULT 0,
  open_rate numeric NULL,
  click_rate numeric NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.newsletter_campaigns ENABLE ROW LEVEL SECURITY;

-- 4. growth_metrics (per user aggregate)
CREATE TABLE IF NOT EXISTS public.growth_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NULL,
  virality_score numeric NOT NULL DEFAULT 0,
  share_rate numeric NOT NULL DEFAULT 0,
  referral_rate numeric NOT NULL DEFAULT 0,
  engagement_score numeric NOT NULL DEFAULT 0,
  content_output_count integer NOT NULL DEFAULT 0,
  total_shares integer NOT NULL DEFAULT 0,
  total_referrals integer NOT NULL DEFAULT 0,
  total_conversions integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, curriculum_id)
);
ALTER TABLE public.growth_metrics ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_growth_metrics_user ON public.growth_metrics(user_id);

-- 5. content_generation_jobs
CREATE TABLE IF NOT EXISTS public.content_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id uuid NULL,
  curriculum_id uuid NULL,
  content_type text NOT NULL,
  persona text NOT NULL DEFAULT 'azubi',
  status text NOT NULL DEFAULT 'queued',
  pipeline_step text NOT NULL DEFAULT 'research_context',
  priority integer NOT NULL DEFAULT 100,
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ssot_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  research_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_brief jsonb NOT NULL DEFAULT '{}'::jsonb,
  draft_content jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  quality_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_content_id uuid NULL,
  output_table text NULL,
  error text NULL,
  retry_count integer NOT NULL DEFAULT 0,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.content_generation_jobs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_cgj_status ON public.content_generation_jobs(status, priority);
CREATE INDEX idx_cgj_keyword ON public.content_generation_jobs(keyword_id);

-- 6. content_ssot_context (cache)
CREATE TABLE IF NOT EXISTS public.content_ssot_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id uuid NOT NULL,
  curriculum_id uuid NULL,
  competencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  blueprints jsonb NOT NULL DEFAULT '[]'::jsonb,
  exam_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  definitions jsonb NOT NULL DEFAULT '[]'::jsonb,
  common_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  context_hash text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(keyword_id)
);
ALTER TABLE public.content_ssot_context ENABLE ROW LEVEL SECURITY;

-- 7. content_research_cache
CREATE TABLE IF NOT EXISTS public.content_research_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id uuid NOT NULL,
  intent_summary text NULL,
  related_terms jsonb NOT NULL DEFAULT '[]'::jsonb,
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  entities jsonb NOT NULL DEFAULT '[]'::jsonb,
  search_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text NOT NULL DEFAULT 'perplexity',
  context_hash text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '3 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(keyword_id)
);
ALTER TABLE public.content_research_cache ENABLE ROW LEVEL SECURITY;

-- 8. user_revenue_profile
CREATE TABLE IF NOT EXISTS public.user_revenue_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NULL,
  readiness_score numeric NOT NULL DEFAULT 0,
  risk_level text NOT NULL DEFAULT 'medium',
  engagement_score numeric NOT NULL DEFAULT 0,
  price_sensitivity text NOT NULL DEFAULT 'medium',
  purchase_probability numeric NOT NULL DEFAULT 0,
  ltv_estimate numeric NOT NULL DEFAULT 0,
  last_offer_shown text NULL,
  last_offer_shown_at timestamptz NULL,
  purchase_count integer NOT NULL DEFAULT 0,
  total_spent numeric NOT NULL DEFAULT 0,
  last_activity_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, curriculum_id)
);
ALTER TABLE public.user_revenue_profile ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_urp_user ON public.user_revenue_profile(user_id);

-- 9. offers
CREATE TABLE IF NOT EXISTS public.offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_type text NOT NULL DEFAULT 'discount',
  title text NOT NULL,
  description text NULL,
  price numeric NULL,
  original_price numeric NULL,
  discount_percentage numeric NULL,
  product_id uuid NULL,
  curriculum_id uuid NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz NULL,
  targeting_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  max_claims integer NULL,
  current_claims integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  priority integer NOT NULL DEFAULT 100,
  cta_text text NULL,
  cta_route text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_offers_status ON public.offers(status, valid_until);

-- 10. product_bundles
CREATE TABLE IF NOT EXISTS public.product_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NULL,
  included_product_ids uuid[] NOT NULL DEFAULT '{}',
  bundle_price numeric NOT NULL,
  original_price numeric NOT NULL,
  savings_percent numeric GENERATED ALWAYS AS (
    CASE WHEN original_price > 0 THEN ROUND((1 - bundle_price / original_price) * 100, 1) ELSE 0 END
  ) STORED,
  target_persona text NULL,
  target_stage text NULL,
  curriculum_id uuid NULL,
  status text NOT NULL DEFAULT 'active',
  valid_until timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.product_bundles ENABLE ROW LEVEL SECURITY;

-- 11. pricing_rules
CREATE TABLE IF NOT EXISTS public.pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name text NOT NULL,
  description text NULL,
  condition jsonb NOT NULL DEFAULT '{}'::jsonb,
  price_modifier numeric NOT NULL DEFAULT 1.0,
  modifier_type text NOT NULL DEFAULT 'multiplier',
  priority integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  valid_from timestamptz NULL,
  valid_until timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;

-- 12. urgency_signals
CREATE TABLE IF NOT EXISTS public.urgency_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NULL,
  exam_date timestamptz NULL,
  days_left integer NULL,
  urgency_level text NOT NULL DEFAULT 'low',
  signal_type text NOT NULL DEFAULT 'exam_countdown',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, curriculum_id, signal_type)
);
ALTER TABLE public.urgency_signals ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_urgency_user ON public.urgency_signals(user_id);

-- 13. retention_actions
CREATE TABLE IF NOT EXISTS public.retention_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  curriculum_id uuid NULL,
  action_type text NOT NULL,
  reason text NULL,
  recommended_offer_id uuid REFERENCES public.offers(id) ON DELETE SET NULL,
  executed boolean NOT NULL DEFAULT false,
  executed_at timestamptz NULL,
  result text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.retention_actions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_retention_user ON public.retention_actions(user_id, executed);

-- 14. revenue_metrics_daily
CREATE TABLE IF NOT EXISTS public.revenue_metrics_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  revenue numeric NOT NULL DEFAULT 0,
  conversion_rate numeric NOT NULL DEFAULT 0,
  avg_order_value numeric NOT NULL DEFAULT 0,
  ltv numeric NOT NULL DEFAULT 0,
  churn_rate numeric NOT NULL DEFAULT 0,
  new_users integer NOT NULL DEFAULT 0,
  active_users integer NOT NULL DEFAULT 0,
  paying_users integer NOT NULL DEFAULT 0,
  offers_shown integer NOT NULL DEFAULT 0,
  offers_claimed integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(date)
);
ALTER TABLE public.revenue_metrics_daily ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RPC Functions
-- ============================================================

-- fn_build_ssot_context: aggregates curriculum context for a keyword
CREATE OR REPLACE FUNCTION public.fn_build_ssot_context(p_keyword_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_keyword record;
  v_result jsonb;
  v_competencies jsonb;
  v_blueprints jsonb;
  v_questions jsonb;
  v_definitions jsonb;
  v_errors jsonb;
BEGIN
  SELECT * INTO v_keyword FROM seo_keywords WHERE id = p_keyword_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','keyword_not_found'); END IF;

  -- Get competencies matching keyword cluster's curriculum
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id, 'title', c.title, 'description', c.description
  )), '[]'::jsonb) INTO v_competencies
  FROM competencies c
  JOIN seo_keyword_clusters kc ON kc.id = v_keyword.cluster_id
  WHERE c.curriculum_id = kc.id::text  -- best-effort match
  LIMIT 20;

  -- Get blueprints (exam question templates)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', qb.id, 'topic', qb.topic, 'variant', qb.variant_type,
    'difficulty', qb.difficulty_level, 'trap', qb.trap_definition
  )), '[]'::jsonb) INTO v_blueprints
  FROM question_blueprints qb
  WHERE qb.topic ILIKE '%' || v_keyword.keyword || '%'
  LIMIT 15;

  -- Get sample exam questions
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', eq.id, 'question_text', LEFT(eq.question_text, 200),
    'difficulty', eq.difficulty_level
  )), '[]'::jsonb) INTO v_questions
  FROM exam_questions eq
  WHERE eq.question_text ILIKE '%' || v_keyword.keyword || '%'
    AND eq.status = 'active'
  LIMIT 10;

  v_result := jsonb_build_object(
    'keyword', v_keyword.keyword,
    'keyword_id', v_keyword.id,
    'competencies', v_competencies,
    'blueprints', v_blueprints,
    'exam_questions', v_questions,
    'built_at', now()
  );

  -- Upsert cache
  INSERT INTO content_ssot_context (keyword_id, competencies, blueprints, exam_questions, context_hash)
  VALUES (p_keyword_id, v_competencies, v_blueprints, v_questions, md5(v_result::text))
  ON CONFLICT (keyword_id) DO UPDATE SET
    competencies = EXCLUDED.competencies,
    blueprints = EXCLUDED.blueprints,
    exam_questions = EXCLUDED.exam_questions,
    context_hash = EXCLUDED.context_hash,
    expires_at = now() + interval '7 days';

  RETURN v_result;
END;
$$;

-- fn_compute_user_revenue_profile
CREATE OR REPLACE FUNCTION public.fn_compute_user_revenue_profile(p_user_id uuid, p_curriculum_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_readiness numeric := 0;
  v_risk text := 'medium';
  v_engagement numeric := 0;
  v_sensitivity text := 'medium';
  v_probability numeric := 0;
  v_ltv numeric := 0;
  v_last_activity timestamptz;
  v_session_count integer := 0;
  v_purchase_count integer := 0;
  v_total_spent numeric := 0;
BEGIN
  -- Readiness from readiness_snapshots
  SELECT rs.readiness_score INTO v_readiness
  FROM readiness_snapshots rs
  WHERE rs.user_id = p_user_id
    AND (p_curriculum_id IS NULL OR rs.curriculum_id = p_curriculum_id)
  ORDER BY rs.created_at DESC LIMIT 1;
  v_readiness := COALESCE(v_readiness, 0);

  -- Risk level
  v_risk := CASE
    WHEN v_readiness < 40 THEN 'high'
    WHEN v_readiness < 70 THEN 'medium'
    ELSE 'low'
  END;

  -- Engagement: count recent sessions (30d)
  SELECT COUNT(*) INTO v_session_count
  FROM exam_sessions es
  WHERE es.user_id = p_user_id
    AND es.created_at > now() - interval '30 days';
  v_engagement := LEAST(v_session_count * 10, 100);

  -- Last activity
  SELECT MAX(es.created_at) INTO v_last_activity
  FROM exam_sessions es WHERE es.user_id = p_user_id;

  -- Purchase data from personal_entitlements
  SELECT COUNT(*), COALESCE(SUM(0), 0) INTO v_purchase_count, v_total_spent
  FROM personal_entitlements pe WHERE pe.user_id = p_user_id;

  -- Purchase probability heuristic
  v_probability := LEAST(100, (v_engagement * 0.4 + v_readiness * 0.3 + CASE WHEN v_risk = 'high' THEN 30 ELSE 10 END));

  -- LTV estimate
  v_ltv := v_total_spent + (v_probability / 100.0 * 49.0);

  -- Price sensitivity
  v_sensitivity := CASE
    WHEN v_purchase_count > 2 THEN 'low'
    WHEN v_engagement > 60 THEN 'medium'
    ELSE 'high'
  END;

  -- Upsert profile
  INSERT INTO user_revenue_profile (user_id, curriculum_id, readiness_score, risk_level,
    engagement_score, price_sensitivity, purchase_probability, ltv_estimate,
    purchase_count, total_spent, last_activity_at)
  VALUES (p_user_id, p_curriculum_id, v_readiness, v_risk, v_engagement, v_sensitivity,
    v_probability, v_ltv, v_purchase_count, v_total_spent, v_last_activity)
  ON CONFLICT (user_id, curriculum_id) DO UPDATE SET
    readiness_score = EXCLUDED.readiness_score,
    risk_level = EXCLUDED.risk_level,
    engagement_score = EXCLUDED.engagement_score,
    price_sensitivity = EXCLUDED.price_sensitivity,
    purchase_probability = EXCLUDED.purchase_probability,
    ltv_estimate = EXCLUDED.ltv_estimate,
    purchase_count = EXCLUDED.purchase_count,
    total_spent = EXCLUDED.total_spent,
    last_activity_at = EXCLUDED.last_activity_at,
    updated_at = now();

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'readiness', v_readiness,
    'risk', v_risk,
    'engagement', v_engagement,
    'sensitivity', v_sensitivity,
    'probability', v_probability,
    'ltv', v_ltv
  );
END;
$$;

-- fn_get_best_offer
CREATE OR REPLACE FUNCTION public.fn_get_best_offer(p_user_id uuid, p_curriculum_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_profile record;
  v_offer record;
  v_reason text;
BEGIN
  SELECT * INTO v_profile FROM user_revenue_profile
  WHERE user_id = p_user_id AND curriculum_id IS NOT DISTINCT FROM p_curriculum_id;

  IF NOT FOUND THEN
    PERFORM fn_compute_user_revenue_profile(p_user_id, p_curriculum_id);
    SELECT * INTO v_profile FROM user_revenue_profile
    WHERE user_id = p_user_id AND curriculum_id IS NOT DISTINCT FROM p_curriculum_id;
  END IF;

  -- Select best matching offer
  SELECT * INTO v_offer FROM offers
  WHERE status = 'active'
    AND (valid_until IS NULL OR valid_until > now())
    AND (max_claims IS NULL OR current_claims < max_claims)
    AND (curriculum_id IS NULL OR curriculum_id = p_curriculum_id)
  ORDER BY
    CASE
      WHEN v_profile.risk_level = 'high' AND offer_type = 'discount' THEN 1
      WHEN v_profile.risk_level = 'high' AND offer_type = 'trial' THEN 2
      WHEN v_profile.engagement_score > 60 AND offer_type = 'upsell' THEN 1
      WHEN v_profile.engagement_score > 60 AND offer_type = 'bundle' THEN 2
      ELSE priority
    END,
    priority ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('offer', null, 'reason', 'no_matching_offer');
  END IF;

  v_reason := CASE
    WHEN v_profile.risk_level = 'high' THEN 'high_risk_discount'
    WHEN v_profile.engagement_score > 60 THEN 'high_engagement_upsell'
    ELSE 'default_priority'
  END;

  -- Track offer shown
  UPDATE user_revenue_profile SET
    last_offer_shown = v_offer.id::text,
    last_offer_shown_at = now(),
    updated_at = now()
  WHERE user_id = p_user_id AND curriculum_id IS NOT DISTINCT FROM p_curriculum_id;

  RETURN jsonb_build_object(
    'offer', jsonb_build_object(
      'id', v_offer.id, 'type', v_offer.offer_type, 'title', v_offer.title,
      'description', v_offer.description, 'price', v_offer.price,
      'original_price', v_offer.original_price, 'discount', v_offer.discount_percentage,
      'cta_text', v_offer.cta_text, 'cta_route', v_offer.cta_route
    ),
    'reason', v_reason,
    'conversion_score', v_profile.purchase_probability
  );
END;
$$;

-- fn_compute_urgency
CREATE OR REPLACE FUNCTION public.fn_compute_urgency(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_rec record;
  v_results jsonb := '[]'::jsonb;
BEGIN
  FOR v_rec IN
    SELECT us.curriculum_id, us.exam_date,
      EXTRACT(DAY FROM us.exam_date - now())::integer AS days_left
    FROM urgency_signals us
    WHERE us.user_id = p_user_id AND us.exam_date > now()
    ORDER BY us.exam_date ASC
  LOOP
    v_results := v_results || jsonb_build_object(
      'curriculum_id', v_rec.curriculum_id,
      'exam_date', v_rec.exam_date,
      'days_left', v_rec.days_left,
      'urgency_level', CASE
        WHEN v_rec.days_left <= 7 THEN 'critical'
        WHEN v_rec.days_left <= 30 THEN 'high'
        WHEN v_rec.days_left <= 60 THEN 'medium'
        ELSE 'low'
      END
    );

    -- Update signal
    UPDATE urgency_signals SET
      days_left = v_rec.days_left,
      urgency_level = CASE
        WHEN v_rec.days_left <= 7 THEN 'critical'
        WHEN v_rec.days_left <= 30 THEN 'high'
        WHEN v_rec.days_left <= 60 THEN 'medium'
        ELSE 'low'
      END,
      updated_at = now()
    WHERE user_id = p_user_id AND curriculum_id = v_rec.curriculum_id AND signal_type = 'exam_countdown';
  END LOOP;

  RETURN jsonb_build_object('user_id', p_user_id, 'signals', v_results);
END;
$$;

-- fn_get_next_revenue_action
CREATE OR REPLACE FUNCTION public.fn_get_next_revenue_action(p_user_id uuid, p_curriculum_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_profile record;
  v_urgency jsonb;
  v_action_type text;
  v_message text;
  v_cta text;
  v_route text;
BEGIN
  SELECT * INTO v_profile FROM user_revenue_profile
  WHERE user_id = p_user_id AND curriculum_id IS NOT DISTINCT FROM p_curriculum_id;

  IF NOT FOUND THEN
    PERFORM fn_compute_user_revenue_profile(p_user_id, p_curriculum_id);
    SELECT * INTO v_profile FROM user_revenue_profile
    WHERE user_id = p_user_id AND curriculum_id IS NOT DISTINCT FROM p_curriculum_id;
  END IF;

  v_urgency := fn_compute_urgency(p_user_id);

  -- Decision tree
  IF v_profile.risk_level = 'high' AND v_profile.engagement_score < 30 THEN
    v_action_type := 'free_check';
    v_message := 'Teste kostenlos deine Prüfungsreife';
    v_cta := 'Jetzt testen';
    v_route := '/pruefung/schnellcheck';
  ELSIF v_profile.risk_level = 'high' AND v_profile.engagement_score >= 30 THEN
    v_action_type := 'bundle';
    v_message := 'Dein Intensiv-Paket für die Prüfung';
    v_cta := 'Bundle ansehen';
    v_route := '/angebote/bundle';
  ELSIF v_profile.engagement_score > 70 AND v_profile.purchase_count = 0 THEN
    v_action_type := 'upsell';
    v_message := 'Schalte Premium frei für noch bessere Ergebnisse';
    v_cta := 'Premium entdecken';
    v_route := '/premium';
  ELSIF v_profile.last_activity_at < now() - interval '7 days' THEN
    v_action_type := 'reminder';
    v_message := 'Dein Training wartet auf dich';
    v_cta := 'Weiterlernen';
    v_route := '/dashboard';
  ELSE
    v_action_type := 'urgency';
    v_message := 'Bleib dran – deine Prüfung kommt näher';
    v_cta := 'Training starten';
    v_route := '/shuttle';
  END IF;

  -- Log retention action
  INSERT INTO retention_actions (user_id, curriculum_id, action_type, reason)
  VALUES (p_user_id, p_curriculum_id, v_action_type, v_message);

  RETURN jsonb_build_object(
    'action_type', v_action_type,
    'message', v_message,
    'cta', v_cta,
    'route', v_route,
    'profile', jsonb_build_object(
      'readiness', v_profile.readiness_score,
      'risk', v_profile.risk_level,
      'engagement', v_profile.engagement_score,
      'probability', v_profile.purchase_probability
    )
  );
END;
$$;

-- fn_compute_growth_score
CREATE OR REPLACE FUNCTION public.fn_compute_growth_score(p_user_id uuid, p_curriculum_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_shares integer := 0;
  v_referrals integer := 0;
  v_conversions integer := 0;
  v_virality numeric := 0;
  v_share_rate numeric := 0;
  v_referral_rate numeric := 0;
  v_engagement numeric := 0;
  v_sessions integer := 0;
BEGIN
  -- Count shares (30d)
  SELECT COUNT(*) INTO v_shares FROM share_events
  WHERE user_id = p_user_id AND created_at > now() - interval '30 days';

  -- Count referrals
  SELECT COUNT(*) INTO v_referrals FROM learner_referrals
  WHERE referrer_user_id = p_user_id AND status = 'claimed';

  -- Count conversion events
  SELECT COUNT(*) INTO v_conversions FROM conversion_events
  WHERE user_id = p_user_id AND event_type = 'purchase';

  -- Sessions (30d)
  SELECT COUNT(*) INTO v_sessions FROM exam_sessions
  WHERE user_id = p_user_id AND created_at > now() - interval '30 days';

  v_share_rate := CASE WHEN v_sessions > 0 THEN (v_shares::numeric / v_sessions * 100) ELSE 0 END;
  v_referral_rate := CASE WHEN v_shares > 0 THEN (v_referrals::numeric / v_shares * 100) ELSE 0 END;
  v_virality := (v_share_rate * 0.3 + v_referral_rate * 0.4 + LEAST(v_referrals * 10, 30));
  v_engagement := LEAST(v_sessions * 5, 100);

  -- Upsert
  INSERT INTO growth_metrics (user_id, curriculum_id, virality_score, share_rate, referral_rate,
    engagement_score, total_shares, total_referrals, total_conversions)
  VALUES (p_user_id, p_curriculum_id, v_virality, v_share_rate, v_referral_rate,
    v_engagement, v_shares, v_referrals, v_conversions)
  ON CONFLICT (user_id, curriculum_id) DO UPDATE SET
    virality_score = EXCLUDED.virality_score,
    share_rate = EXCLUDED.share_rate,
    referral_rate = EXCLUDED.referral_rate,
    engagement_score = EXCLUDED.engagement_score,
    total_shares = EXCLUDED.total_shares,
    total_referrals = EXCLUDED.total_referrals,
    total_conversions = EXCLUDED.total_conversions,
    updated_at = now();

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'virality_score', v_virality,
    'share_rate', v_share_rate,
    'referral_rate', v_referral_rate,
    'engagement', v_engagement,
    'total_shares', v_shares,
    'total_referrals', v_referrals
  );
END;
$$;

-- fn_get_growth_dashboard_summary
CREATE OR REPLACE FUNCTION public.fn_get_growth_dashboard_summary()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_shares_30d', (SELECT COUNT(*) FROM share_events WHERE created_at > now() - interval '30 days'),
    'total_referrals_30d', (SELECT COUNT(*) FROM learner_referrals WHERE created_at > now() - interval '30 days'),
    'total_conversions_30d', (SELECT COUNT(*) FROM conversion_events WHERE event_type = 'purchase' AND created_at > now() - interval '30 days'),
    'avg_virality_score', (SELECT COALESCE(AVG(virality_score), 0) FROM growth_metrics),
    'avg_share_rate', (SELECT COALESCE(AVG(share_rate), 0) FROM growth_metrics),
    'active_offers', (SELECT COUNT(*) FROM offers WHERE status = 'active' AND (valid_until IS NULL OR valid_until > now())),
    'active_bundles', (SELECT COUNT(*) FROM product_bundles WHERE status = 'active'),
    'content_jobs_queued', (SELECT COUNT(*) FROM content_generation_jobs WHERE status = 'queued'),
    'content_jobs_done', (SELECT COUNT(*) FROM content_generation_jobs WHERE status = 'done'),
    'content_jobs_failed', (SELECT COUNT(*) FROM content_generation_jobs WHERE status = 'failed'),
    'newsletter_sent', (SELECT COUNT(*) FROM newsletter_campaigns WHERE status = 'sent'),
    'ugc_pending', (SELECT COUNT(*) FROM ugc_content WHERE approved = false),
    'retention_actions_30d', (SELECT COUNT(*) FROM retention_actions WHERE created_at > now() - interval '30 days'),
    'revenue_today', (SELECT COALESCE(revenue, 0) FROM revenue_metrics_daily WHERE date = CURRENT_DATE)
  ) INTO v_result;

  RETURN v_result;
END;
$$;
