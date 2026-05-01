-- Bridge: grant_learner_course_access schreibt zusätzlich in entitlements
CREATE OR REPLACE FUNCTION public.grant_learner_course_access(
  p_user_id uuid,
  p_curriculum_id uuid,
  p_product_id uuid DEFAULT NULL::uuid,
  p_source text DEFAULT 'order'::text,
  p_order_id uuid DEFAULT NULL::uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE 
  v_id UUID; 
  v_access_months INT;
  v_valid_until TIMESTAMPTZ;
  v_existing_ent_id UUID;
BEGIN
  -- (1) learner_course_grants UPSERT (unverändert)
  INSERT INTO public.learner_course_grants(
    user_id, curriculum_id, product_id, source, order_id, status, activated_at, metadata
  )
  VALUES (
    p_user_id, p_curriculum_id, p_product_id, p_source, p_order_id, 'active', now(), 
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (user_id, curriculum_id) DO UPDATE
    SET status = 'active',
        order_id = COALESCE(EXCLUDED.order_id, public.learner_course_grants.order_id),
        product_id = COALESCE(EXCLUDED.product_id, public.learner_course_grants.product_id),
        metadata = public.learner_course_grants.metadata || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
        activated_at = COALESCE(public.learner_course_grants.activated_at, now()),
        updated_at = now()
  RETURNING id INTO v_id;

  -- (2) Bridge → entitlements: Laufzeit aus product_prices ableiten
  SELECT COALESCE(MAX(pp.access_months), 12) INTO v_access_months
  FROM public.product_prices pp
  WHERE pp.product_id = p_product_id AND pp.active = true;

  v_valid_until := now() + (v_access_months || ' months')::interval;

  -- Lookup bestehender ent (seat_id IS NULL → distinct in unique index)
  SELECT id INTO v_existing_ent_id
  FROM public.entitlements
  WHERE user_id = p_user_id 
    AND curriculum_id = p_curriculum_id 
    AND seat_id IS NULL
  LIMIT 1;

  IF v_existing_ent_id IS NOT NULL THEN
    -- UPDATE: verlängere oder behalte längeres valid_until
    UPDATE public.entitlements
    SET valid_until = GREATEST(valid_until, v_valid_until),
        valid_from = LEAST(valid_from, now()),
        has_learning_course = true,
        has_exam_trainer = true,
        has_ai_tutor = true,
        has_oral_trainer = true,
        product_id = COALESCE(p_product_id, product_id),
        source = COALESCE(p_source, source),
        source_type = 'web_purchase',
        source_ref = COALESCE(p_order_id::text, source_ref),
        metadata_json = metadata_json || COALESCE(p_metadata, '{}'::jsonb)
    WHERE id = v_existing_ent_id;
  ELSE
    -- INSERT
    INSERT INTO public.entitlements(
      user_id, curriculum_id, seat_id, product_id,
      valid_from, valid_until,
      source, source_type, source_ref,
      has_learning_course, has_exam_trainer, has_ai_tutor, has_oral_trainer,
      metadata_json
    )
    VALUES (
      p_user_id, p_curriculum_id, NULL, p_product_id,
      now(), v_valid_until,
      COALESCE(p_source, 'web'), 'web_purchase', p_order_id::text,
      true, true, true, true,
      COALESCE(p_metadata, '{}'::jsonb)
    );
  END IF;

  RETURN v_id;
END $function$;

-- Audit
INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
VALUES (
  'license_bridge_fix',
  'system',
  'grant_learner_course_access',
  'success',
  jsonb_build_object(
    'fix', 'bridge_to_entitlements',
    'reason', 'tutor_access_check liest entitlements, grant schrieb nur in learner_course_grants',
    'access_months_default', 12,
    'access_months_source', 'product_prices.access_months',
    'detected_during', 'e2e_smoke_hybrid_v1'
  )
);