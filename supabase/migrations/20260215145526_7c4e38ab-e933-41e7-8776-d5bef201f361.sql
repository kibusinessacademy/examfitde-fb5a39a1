
-- ============================================================
-- PATCH 1: Dynamic LLM routing rules (DB-driven)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.model_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  priority int NOT NULL DEFAULT 100,
  is_fallback boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  budget_cap_eur numeric NULL,
  max_output_tokens int NULL,
  temperature numeric NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS model_routing_rules_intent_priority_uq
  ON public.model_routing_rules(intent, priority);

CREATE INDEX IF NOT EXISTS model_routing_rules_lookup_idx
  ON public.model_routing_rules(intent, enabled, priority);

-- Touch updated_at trigger (CREATE OR REPLACE safe)
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_model_routing_rules_touch ON public.model_routing_rules;
CREATE TRIGGER trg_model_routing_rules_touch
BEFORE UPDATE ON public.model_routing_rules
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS
ALTER TABLE public.model_routing_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "model_routing_rules_admin_read" ON public.model_routing_rules;
CREATE POLICY "model_routing_rules_admin_read"
ON public.model_routing_rules FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "model_routing_rules_service_all" ON public.model_routing_rules;
CREATE POLICY "model_routing_rules_service_all"
ON public.model_routing_rules FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Seed defaults (matching current hardcoded routing)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.model_routing_rules) THEN
    INSERT INTO public.model_routing_rules(intent, provider, model, priority, is_fallback, enabled, notes) VALUES
      ('exam_questions',   'openai',    'gpt-4.1-mini',              10, false, true, 'default seed'),
      ('exam_questions',   'openai',    'gpt-4.1',                   20, true,  true, 'default seed'),
      ('oral_exam',        'openai',    'gpt-4.1-mini',              10, false, true, 'default seed'),
      ('oral_exam',        'openai',    'gpt-4.1',                   20, true,  true, 'default seed'),
      ('support',          'openai',    'gpt-4.1-mini',              10, false, true, 'default seed'),
      ('support',          'deepseek',  'deepseek-chat',             20, true,  true, 'default seed'),
      ('learning_course',  'anthropic', 'claude-sonnet-4-20250514',  10, false, true, 'default seed'),
      ('learning_course',  'openai',    'gpt-4.1',                   20, true,  true, 'default seed'),
      ('handbook',         'anthropic', 'claude-sonnet-4-20250514',  10, false, true, 'default seed'),
      ('handbook',         'openai',    'gpt-4.1',                   20, true,  true, 'default seed'),
      ('council_review',   'anthropic', 'claude-sonnet-4-20250514',  10, false, true, 'default seed'),
      ('council_review',   'openai',    'gpt-4.1',                   20, true,  true, 'default seed'),
      ('quality_audit',    'openai',    'gpt-4.1',                   10, false, true, 'default seed'),
      ('quality_audit',    'anthropic', 'claude-sonnet-4-20250514',  20, true,  true, 'default seed'),
      ('seo_content',      'anthropic', 'claude-sonnet-4-20250514',  10, false, true, 'default seed'),
      ('seo_content',      'openai',    'gpt-4.1',                   20, true,  true, 'default seed'),
      ('minicheck',        'openai',    'gpt-4.1-mini',              10, false, true, 'default seed'),
      ('minicheck',        'openai',    'gpt-4.1',                   20, true,  true, 'default seed'),
      ('summary',          'openai',    'gpt-4.1-mini',              10, false, true, 'default seed'),
      ('summary',          'deepseek',  'deepseek-chat',             20, true,  true, 'default seed'),
      ('repair',           'openai',    'gpt-4.1-mini',              10, false, true, 'default seed'),
      ('repair',           'openai',    'gpt-4.1',                   20, true,  true, 'default seed'),
      ('repair_content',   'anthropic', 'claude-sonnet-4-20250514',  10, false, true, 'default seed'),
      ('repair_content',   'openai',    'gpt-4.1',                   20, true,  true, 'default seed'),
      ('blooms_classify',  'openai',    'gpt-4.1-mini',              10, false, true, 'default seed'),
      ('blooms_classify',  'openai',    'gpt-4.1',                   20, true,  true, 'default seed'),
      ('curriculum_import','openai',    'gpt-4.1',                   10, false, true, 'default seed'),
      ('curriculum_import','anthropic', 'claude-sonnet-4-20250514',  20, true,  true, 'default seed'),
      ('embeddings',       'openai',    'text-embedding-3-large',    10, false, true, 'default seed'),
      ('images',           'openai',    'gpt-image-1',               10, false, true, 'default seed');
  END IF;
END $$;

-- ============================================================
-- PATCH 2: package_economics View (ROI pro Package)
-- ============================================================
CREATE OR REPLACE VIEW public.package_economics AS
WITH cost_30d AS (
  SELECT
    package_id,
    sum(cost_eur)::numeric AS cost_eur_30d,
    sum(tokens_in)::bigint AS tokens_in_30d,
    sum(tokens_out)::bigint AS tokens_out_30d,
    count(*)::bigint AS calls_30d
  FROM public.llm_cost_events
  WHERE ts >= now() - interval '30 days'
  GROUP BY package_id
),
rev_30d AS (
  SELECT
    course_id,
    sum(amount)::numeric AS revenue_30d,
    count(*)::bigint AS purchases_30d
  FROM public.revenue_events
  WHERE created_at >= now() - interval '30 days'
    AND event_type IN ('purchase','payment_succeeded','checkout_completed')
  GROUP BY course_id
)
SELECT
  cp.id AS package_id,
  cp.course_id,
  cp.status,
  cp.created_at,
  coalesce(c.cost_eur_30d, 0)::numeric AS cost_eur_30d,
  coalesce(r.revenue_30d, 0)::numeric AS revenue_eur_30d,
  (coalesce(r.revenue_30d, 0) - coalesce(c.cost_eur_30d, 0))::numeric AS gross_margin_eur_30d,
  CASE WHEN coalesce(c.cost_eur_30d, 0) > 0
    THEN coalesce(r.revenue_30d, 0) / nullif(c.cost_eur_30d, 0)
    ELSE null
  END AS roi_30d,
  coalesce(c.calls_30d, 0)::bigint AS llm_calls_30d,
  coalesce(c.tokens_in_30d, 0)::bigint AS tokens_in_30d,
  coalesce(c.tokens_out_30d, 0)::bigint AS tokens_out_30d,
  pqs.quality_score,
  pqs.quality_badge
FROM public.course_packages cp
LEFT JOIN cost_30d c ON c.package_id = cp.id
LEFT JOIN rev_30d r ON r.course_id = cp.course_id
LEFT JOIN public.package_quality_summary pqs ON pqs.package_id = cp.id;

-- ============================================================
-- PATCH 3: IRT Adaptive Sequencing RPCs
-- ============================================================

-- Pick next best question for adaptive session
CREATE OR REPLACE FUNCTION public.pick_next_adaptive_question(p_session_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user uuid;
  v_curriculum uuid;
  v_theta numeric;
  v_q uuid;
  v_max_order int;
BEGIN
  SELECT user_id, curriculum_id
    INTO v_user, v_curriculum
  FROM public.exam_sessions
  WHERE id = p_session_id;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;

  -- Get current theta
  SELECT coalesce(theta_overall, 0)
    INTO v_theta
  FROM public.user_ability_profiles
  WHERE user_id = v_user AND curriculum_id = v_curriculum;

  IF v_theta IS NULL THEN v_theta := 0; END IF;

  -- Choose best next question not yet in this session
  SELECT eq.id INTO v_q
  FROM public.exam_questions eq
  LEFT JOIN public.exam_session_questions esq
    ON esq.exam_session_id = p_session_id AND esq.question_id = eq.id
  WHERE eq.curriculum_id = v_curriculum
    AND esq.question_id IS NULL
    AND eq.status = 'approved'
  ORDER BY
    coalesce(eq.discrimination, 1.0) DESC,
    abs(coalesce(eq.item_difficulty, 0) - v_theta) ASC,
    random()
  LIMIT 1;

  RETURN v_q;
END $$;

-- Append next question into exam_session_questions
CREATE OR REPLACE FUNCTION public.append_next_adaptive_question(p_session_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_q uuid;
  v_max_order int;
  v_difficulty text;
BEGIN
  v_q := public.pick_next_adaptive_question(p_session_id);
  IF v_q IS NULL THEN RETURN NULL; END IF;

  -- Get current max order_index
  SELECT coalesce(max(order_index), -1) INTO v_max_order
  FROM public.exam_session_questions
  WHERE exam_session_id = p_session_id;

  -- Get difficulty label for the question
  SELECT coalesce(
    CASE
      WHEN eq.item_difficulty < -1 THEN 'easy'
      WHEN eq.item_difficulty < 0.5 THEN 'medium'
      WHEN eq.item_difficulty < 1.5 THEN 'hard'
      ELSE 'very_hard'
    END, 'medium'
  ) INTO v_difficulty
  FROM public.exam_questions eq WHERE eq.id = v_q;

  INSERT INTO public.exam_session_questions(exam_session_id, question_id, order_index, difficulty)
  VALUES (p_session_id, v_q, v_max_order + 1, coalesce(v_difficulty, 'medium'))
  ON CONFLICT DO NOTHING;

  RETURN v_q;
END $$;

-- ============================================================
-- PATCH 4: Calibration Drift Decay
-- ============================================================
CREATE OR REPLACE FUNCTION public.calibrate_item_difficulty(p_question_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_n int;
  v_correct_rate numeric;
  v_new_diff numeric;
BEGIN
  WITH base AS (
    SELECT
      (is_correct)::int AS y,
      answered_at,
      exp(-extract(epoch FROM (now() - answered_at)) / (60*24*3600)) AS w
    FROM public.exam_session_questions
    WHERE question_id = p_question_id
      AND answered_at IS NOT NULL
      AND is_correct IS NOT NULL
    ORDER BY answered_at DESC
    LIMIT 1000
  ),
  stats AS (
    SELECT
      count(*)::int AS n,
      sum(w * y)::numeric / nullif(sum(w), 0) AS p
    FROM base
  )
  SELECT n, p INTO v_n, v_correct_rate FROM stats;

  IF v_n < 30 OR v_correct_rate IS NULL THEN RETURN; END IF;

  v_correct_rate := greatest(0.05, least(0.95, v_correct_rate));
  v_new_diff := -ln(v_correct_rate / (1 - v_correct_rate));

  UPDATE public.exam_questions
  SET item_difficulty = v_new_diff, updated_at = now()
  WHERE id = p_question_id;
END $$;

-- ============================================================
-- PATCH 5: Dynamic Pricing RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_effective_price(
  p_product_id text,
  p_quantity int
)
RETURNS TABLE (
  product_id text,
  quantity int,
  unit_price_cents int,
  total_price_cents int,
  stripe_price_id text
)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    ppt.product_id::text,
    p_quantity AS quantity,
    ppt.price_cents::int AS unit_price_cents,
    (ppt.price_cents * p_quantity)::int AS total_price_cents,
    ppt.stripe_price_id
  FROM public.product_price_tiers ppt
  WHERE ppt.product_id::text = p_product_id
    AND ppt.min_quantity <= p_quantity
  ORDER BY ppt.min_quantity DESC
  LIMIT 1;
$$;

-- ============================================================
-- PATCH 6: Corporate Seat Hardening + Utilization View
-- ============================================================

-- Prevent seat reassignment
CREATE OR REPLACE FUNCTION public.prevent_seat_reassignment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.assigned_user_id IS NOT NULL
     AND NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id THEN
    RAISE EXCEPTION 'seat_reassignment_not_allowed';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_prevent_seat_reassignment ON public.license_seats;
CREATE TRIGGER trg_prevent_seat_reassignment
BEFORE UPDATE ON public.license_seats
FOR EACH ROW EXECUTE FUNCTION public.prevent_seat_reassignment();

-- Utilization view (corrected column names)
CREATE OR REPLACE VIEW public.corporate_seat_utilization AS
SELECT
  lp.id AS license_package_id,
  lp.buyer_user_id,
  lp.company_id,
  lp.product_id,
  lp.quantity AS seats_total,
  count(ls.id) FILTER (WHERE ls.assigned_user_id IS NOT NULL) AS seats_used,
  (lp.quantity - count(ls.id) FILTER (WHERE ls.assigned_user_id IS NOT NULL))::int AS seats_free,
  round(
    count(ls.id) FILTER (WHERE ls.assigned_user_id IS NOT NULL)::numeric
    / nullif(lp.quantity, 0) * 100, 1
  ) AS utilization_pct,
  min(ls.assigned_at) AS first_seat_assigned,
  max(ls.assigned_at) AS last_seat_assigned
FROM public.license_packages lp
LEFT JOIN public.license_seats ls ON ls.package_id = lp.id
GROUP BY lp.id, lp.buyer_user_id, lp.company_id, lp.product_id, lp.quantity;

-- ============================================================
-- PATCH 7: Premium Feature Matrix
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_features (
  product_id uuid NOT NULL,
  feature_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, feature_key)
);

ALTER TABLE public.product_features ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_features_admin_read" ON public.product_features;
CREATE POLICY "product_features_admin_read"
ON public.product_features FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "product_features_service_all" ON public.product_features;
CREATE POLICY "product_features_service_all"
ON public.product_features FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Public read for feature gating in frontend
DROP POLICY IF EXISTS "product_features_public_read" ON public.product_features;
CREATE POLICY "product_features_public_read"
ON public.product_features FOR SELECT TO anon
USING (enabled = true);
