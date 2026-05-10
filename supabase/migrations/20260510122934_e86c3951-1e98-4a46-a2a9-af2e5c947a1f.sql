
-- ============================================================
-- Access SSOT Single-Choke-Point: tutor + storage gates
-- ============================================================
-- Beide Gates akzeptieren ab jetzt:
--   (a) entitlement mit passendem Feature-Flag (alt)
--   (b) ODER aktiven learner_course_grant fürs Curriculum (neu, Loop-C SSOT)
-- Damit ist der Resolver konsistent zu check_product_access_by_curriculum
-- (Lernkurs/Exam/Oral nutzen den schon).

-- 1) tutor_access_check: Grant ODER Entitlement(has_ai_tutor)
CREATE OR REPLACE FUNCTION public.tutor_access_check(
  p_curriculum_id uuid,
  p_daily_limit integer DEFAULT 200,
  p_user_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := COALESCE(p_user_id, auth.uid());
  v_has_ent boolean;
  v_has_grant boolean;
  v_count int;
  v_source text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'unauthenticated');
  END IF;

  IF public.has_role(v_uid, 'admin') THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'admin');
  END IF;

  -- Path A: entitlement mit explizitem Feature-Flag
  v_has_ent := public.check_user_entitlement(v_uid, p_curriculum_id, 'ai_tutor');

  -- Path D: aktiver Grant (Loop-C SSOT) — Grant impliziert alle 4 Features
  v_has_grant := EXISTS (
    SELECT 1 FROM public.learner_course_grants g
    WHERE g.user_id = v_uid
      AND g.curriculum_id = p_curriculum_id
      AND g.status = 'active'
  );

  IF NOT v_has_ent AND NOT v_has_grant THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_entitlement');
  END IF;

  v_source := CASE WHEN v_has_ent THEN 'entitlement' ELSE 'grant' END;

  SELECT COUNT(*) INTO v_count
  FROM public.ai_tutor_logs
  WHERE user_id = v_uid
    AND created_at >= (now() - interval '24 hours')
    AND COALESCE(was_blocked, false) = false;

  IF v_count >= p_daily_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'rate_limit',
                              'used', v_count, 'limit', p_daily_limit, 'source', v_source);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'reason', 'ok',
                            'used', v_count, 'limit', p_daily_limit, 'source', v_source);
END
$function$;

-- 2) has_storage_entitlement: Grant ODER Entitlement
CREATE OR REPLACE FUNCTION public.has_storage_entitlement(
  p_user_id uuid,
  p_curriculum_id uuid DEFAULT NULL::uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Admin-Bypass
  IF public.has_role(p_user_id, 'admin') THEN
    RETURN true;
  END IF;

  IF p_curriculum_id IS NULL THEN
    -- "Hat irgendeinen Zugang?"
    RETURN EXISTS (
      SELECT 1 FROM public.entitlements
      WHERE user_id = p_user_id
        AND (valid_until IS NULL OR valid_until > now())
    ) OR EXISTS (
      SELECT 1 FROM public.learner_course_grants
      WHERE user_id = p_user_id AND status = 'active'
    );
  END IF;

  -- Curriculum-spezifisch: entitlement ODER grant
  RETURN EXISTS (
    SELECT 1 FROM public.entitlements
    WHERE user_id = p_user_id
      AND curriculum_id = p_curriculum_id
      AND (valid_until IS NULL OR valid_until > now())
  ) OR EXISTS (
    SELECT 1 FROM public.learner_course_grants
    WHERE user_id = p_user_id
      AND curriculum_id = p_curriculum_id
      AND status = 'active'
  );
END;
$function$;

-- Audit
INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
VALUES (
  'access_ssot_choke_point_applied','system','success',
  jsonb_build_object(
    'migration','tutor_storage_grants_ssot',
    'rpcs',jsonb_build_array('tutor_access_check','has_storage_entitlement'),
    'rule','grants_OR_entitlements_via_loop_c_bridge'
  )
);

-- Smoke (logs only, kein Fail bei 0)
DO $$
DECLARE v_real_grants_no_ent int; v_paid_no_grant int;
BEGIN
  SELECT COUNT(*) INTO v_real_grants_no_ent
  FROM learner_course_grants g
  WHERE g.status='active'
    AND NOT EXISTS (
      SELECT 1 FROM entitlements e
      WHERE e.user_id=g.user_id AND e.curriculum_id=g.curriculum_id
    );
  SELECT COUNT(*) INTO v_paid_no_grant
  FROM orders o
  WHERE o.status='paid'
    AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id=o.id)
    AND NOT EXISTS (SELECT 1 FROM learner_course_grants g WHERE g.order_id=o.id);
  RAISE NOTICE 'access_ssot baseline: grants_no_ent=% paid_no_grant=%', v_real_grants_no_ent, v_paid_no_grant;
END $$;
