CREATE OR REPLACE FUNCTION public.tutor_access_check(
  p_curriculum_id uuid,
  p_daily_limit integer DEFAULT 200,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := COALESCE(p_user_id, auth.uid());
  v_has BOOLEAN;
  v_count INT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'unauthenticated');
  END IF;

  IF public.has_role(v_uid, 'admin') THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'admin');
  END IF;

  v_has := public.check_user_entitlement(v_uid, p_curriculum_id, 'ai_tutor');
  IF NOT v_has THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_entitlement');
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.ai_tutor_logs
  WHERE user_id = v_uid
    AND created_at >= (now() - interval '24 hours')
    AND COALESCE(was_blocked, false) = false;

  IF v_count >= p_daily_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'rate_limit', 'used', v_count, 'limit', p_daily_limit);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'reason', 'ok', 'used', v_count, 'limit', p_daily_limit);
END
$function$;