
-- LOOP C: License-Rollout & AI-Tutor Strict-RAG (separate names to avoid clash)

-- 1) AI Tutor Audit
CREATE TABLE IF NOT EXISTS public.ai_tutor_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  session_id UUID NULL,
  curriculum_id UUID NULL,
  lesson_id UUID NULL,
  competency_id UUID NULL,
  generation_id UUID NULL,
  mode TEXT NOT NULL,
  role TEXT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('allowed','blocked_no_citation','blocked_no_entitlement','blocked_rate_limit','blocked_exam_mode','blocked_off_topic','validator_rejected')),
  block_reason TEXT NULL,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  citation_count INT NOT NULL DEFAULT 0,
  validator_score NUMERIC NULL,
  validator_decision TEXT NULL,
  prompt_excerpt TEXT NULL,
  response_excerpt TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_tutor_audit_user ON public.ai_tutor_audit(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_tutor_audit_curr ON public.ai_tutor_audit(curriculum_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_tutor_audit_decision ON public.ai_tutor_audit(decision, created_at DESC);
ALTER TABLE public.ai_tutor_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_tutor_audit_owner_select" ON public.ai_tutor_audit;
CREATE POLICY "ai_tutor_audit_owner_select" ON public.ai_tutor_audit FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "ai_tutor_audit_service_insert" ON public.ai_tutor_audit;
CREATE POLICY "ai_tutor_audit_service_insert" ON public.ai_tutor_audit FOR INSERT WITH CHECK (true);

-- 2) Learner Course Grants (kanonisches Onboarding nach Order paid)
CREATE TABLE IF NOT EXISTS public.learner_course_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  curriculum_id UUID NOT NULL,
  product_id UUID NULL,
  source TEXT NOT NULL DEFAULT 'order',
  source_ref TEXT NULL,
  order_id UUID NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','paused','completed','revoked')),
  onboarding_status TEXT NOT NULL DEFAULT 'pending' CHECK (onboarding_status IN ('pending','intro_done','first_lesson_done','first_minicheck_done','exam_taken','completed')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, curriculum_id)
);
CREATE INDEX IF NOT EXISTS idx_learner_grants_user ON public.learner_course_grants(user_id);
CREATE INDEX IF NOT EXISTS idx_learner_grants_order ON public.learner_course_grants(order_id);
ALTER TABLE public.learner_course_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "learner_grants_owner_select" ON public.learner_course_grants;
CREATE POLICY "learner_grants_owner_select" ON public.learner_course_grants FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "learner_grants_admin_all" ON public.learner_course_grants;
CREATE POLICY "learner_grants_admin_all" ON public.learner_course_grants FOR ALL
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.touch_learner_course_grants_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_learner_grants_touch ON public.learner_course_grants;
CREATE TRIGGER trg_learner_grants_touch BEFORE UPDATE ON public.learner_course_grants
  FOR EACH ROW EXECUTE FUNCTION public.touch_learner_course_grants_updated_at();

-- 3) tutor_access_check
CREATE OR REPLACE FUNCTION public.tutor_access_check(p_curriculum_id UUID, p_daily_limit INT DEFAULT 200)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID := auth.uid(); v_has BOOLEAN; v_count INT;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('allowed', false, 'reason', 'unauthenticated'); END IF;
  IF public.has_role(v_uid, 'admin') THEN RETURN jsonb_build_object('allowed', true, 'reason', 'admin'); END IF;
  v_has := public.check_user_entitlement(v_uid, p_curriculum_id, 'ai_tutor');
  IF NOT v_has THEN RETURN jsonb_build_object('allowed', false, 'reason', 'no_entitlement'); END IF;
  SELECT COUNT(*) INTO v_count FROM public.ai_tutor_logs
  WHERE user_id = v_uid AND created_at >= (now() - interval '24 hours') AND COALESCE(was_blocked, false) = false;
  IF v_count >= p_daily_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'rate_limit', 'used', v_count, 'limit', p_daily_limit);
  END IF;
  RETURN jsonb_build_object('allowed', true, 'reason', 'ok', 'used', v_count, 'limit', p_daily_limit);
END $$;
GRANT EXECUTE ON FUNCTION public.tutor_access_check(UUID, INT) TO authenticated;

-- 4) tutor_log_audit
CREATE OR REPLACE FUNCTION public.tutor_log_audit(
  p_user_id UUID, p_session_id UUID, p_curriculum_id UUID, p_lesson_id UUID, p_competency_id UUID,
  p_generation_id UUID, p_mode TEXT, p_role TEXT, p_decision TEXT, p_block_reason TEXT,
  p_source_refs JSONB, p_validator_score NUMERIC, p_validator_decision TEXT,
  p_prompt_excerpt TEXT, p_response_excerpt TEXT, p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID; v_count INT;
BEGIN
  v_count := COALESCE(jsonb_array_length(COALESCE(p_source_refs, '[]'::jsonb)), 0);
  INSERT INTO public.ai_tutor_audit(
    user_id, session_id, curriculum_id, lesson_id, competency_id, generation_id, mode, role,
    decision, block_reason, source_refs, citation_count, validator_score, validator_decision,
    prompt_excerpt, response_excerpt, metadata
  ) VALUES (
    p_user_id, p_session_id, p_curriculum_id, p_lesson_id, p_competency_id, p_generation_id,
    p_mode, p_role, p_decision, p_block_reason, COALESCE(p_source_refs, '[]'::jsonb), v_count,
    p_validator_score, p_validator_decision,
    LEFT(COALESCE(p_prompt_excerpt, ''), 500), LEFT(COALESCE(p_response_excerpt, ''), 1000),
    COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 5) grant_learner_course_access (idempotent)
CREATE OR REPLACE FUNCTION public.grant_learner_course_access(
  p_user_id UUID, p_curriculum_id UUID, p_product_id UUID DEFAULT NULL,
  p_source TEXT DEFAULT 'order', p_order_id UUID DEFAULT NULL, p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.learner_course_grants(user_id, curriculum_id, product_id, source, order_id, status, activated_at, metadata)
  VALUES (p_user_id, p_curriculum_id, p_product_id, p_source, p_order_id, 'active', now(), COALESCE(p_metadata, '{}'::jsonb))
  ON CONFLICT (user_id, curriculum_id) DO UPDATE
    SET status = 'active',
        order_id = COALESCE(EXCLUDED.order_id, public.learner_course_grants.order_id),
        product_id = COALESCE(EXCLUDED.product_id, public.learner_course_grants.product_id),
        metadata = public.learner_course_grants.metadata || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
        activated_at = COALESCE(public.learner_course_grants.activated_at, now()),
        updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 6) process_order_paid_fulfillment
CREATE OR REPLACE FUNCTION public.process_order_paid_fulfillment(p_order_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order RECORD; v_curriculum_id UUID; v_product_id UUID;
BEGIN
  SELECT id, buyer_user_id, learner_user_id, billing_email, status,
         stripe_checkout_session_id, stripe_payment_intent_id
    INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order IS NULL OR v_order.status <> 'paid' THEN RETURN; END IF;

  SELECT p.curriculum_id, p.id INTO v_curriculum_id, v_product_id
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = p_order_id AND p.curriculum_id IS NOT NULL
  ORDER BY oi.created_at ASC LIMIT 1;

  IF v_curriculum_id IS NOT NULL AND COALESCE(v_order.learner_user_id, v_order.buyer_user_id) IS NOT NULL THEN
    PERFORM public.grant_learner_course_access(
      COALESCE(v_order.learner_user_id, v_order.buyer_user_id),
      v_curriculum_id, v_product_id, 'order', v_order.id,
      jsonb_build_object('stripe_session', v_order.stripe_checkout_session_id,
                         'stripe_payment_intent', v_order.stripe_payment_intent_id)
    );
  END IF;

  BEGIN
    INSERT INTO public.crm_activities(contact_id, activity_type, subject, body)
    SELECT c.id, 'order_fulfilled', 'Order fulfilled & enrolled',
           'Order ' || v_order.id::text || ' paid; learner enrolled in curriculum ' || COALESCE(v_curriculum_id::text, 'n/a')
    FROM public.crm_contacts c
    WHERE LOWER(c.email) = LOWER(COALESCE(v_order.billing_email, '')) LIMIT 1;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

-- 7) Trigger
CREATE OR REPLACE FUNCTION public.trg_orders_paid_grant_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'UPDATE' AND NEW.status = 'paid' AND COALESCE(OLD.status, '') <> 'paid')
     OR (TG_OP = 'INSERT' AND NEW.status = 'paid') THEN
    BEGIN PERFORM public.process_order_paid_fulfillment(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[orders_paid_grant] Failed for order %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_orders_paid_grant ON public.orders;
CREATE TRIGGER trg_orders_paid_grant AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_orders_paid_grant_fn();

-- 8) KPI View
CREATE OR REPLACE VIEW public.v_ai_tutor_audit_kpis AS
SELECT date_trunc('day', created_at)::date AS day, decision,
       COUNT(*) AS cnt,
       AVG(citation_count)::numeric(10,2) AS avg_citations,
       AVG(validator_score)::numeric(10,2) AS avg_validator_score
FROM public.ai_tutor_audit
WHERE created_at >= now() - interval '30 days'
GROUP BY 1, 2 ORDER BY 1 DESC, 2;
GRANT SELECT ON public.v_ai_tutor_audit_kpis TO authenticated;
