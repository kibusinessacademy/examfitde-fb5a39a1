
-- =========================================================
-- Admin Test Access: RPC Hardening (anti-spoof)
-- - Anti-spoof: p_user_id muss auth.uid() sein (außer service_role)
-- - Admin-Check via v_effective_user:
--     * normal: auth.uid()
--     * service_role: p_user_id (Edge Functions)
-- =========================================================

CREATE OR REPLACE FUNCTION public.check_user_entitlement(
  p_user_id uuid,
  p_curriculum_id uuid,
  p_feature text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := auth.role();
  v_effective_user uuid;
BEGIN
  v_effective_user := CASE
    WHEN v_role = 'service_role' THEN p_user_id
    ELSE v_uid
  END;

  -- Anti-spoof for non-service callers
  IF v_role IS DISTINCT FROM 'service_role' AND p_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Admin bypass (based on effective user)
  IF public.has_role(v_effective_user, 'admin') THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.entitlements e
    WHERE e.user_id = p_user_id
      AND e.curriculum_id = p_curriculum_id
      AND e.valid_until > now()
      AND (
        (p_feature = 'learning_course' AND e.has_learning_course = true) OR
        (p_feature = 'exam_trainer'   AND e.has_exam_trainer = true) OR
        (p_feature = 'ai_tutor'       AND e.has_ai_tutor = true) OR
        (p_feature = 'oral_trainer'   AND e.has_oral_trainer = true)
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_entitlements(
  p_user_id uuid,
  p_curriculum_id uuid DEFAULT NULL
)
RETURNS TABLE(
  curriculum_id uuid,
  has_learning_course boolean,
  has_exam_trainer boolean,
  has_ai_tutor boolean,
  has_oral_trainer boolean,
  valid_until timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := auth.role();
  v_effective_user uuid;
BEGIN
  v_effective_user := CASE
    WHEN v_role = 'service_role' THEN p_user_id
    ELSE v_uid
  END;

  -- Anti-spoof for non-service callers
  IF v_role IS DISTINCT FROM 'service_role' AND p_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Admin bypass: return full entitlements for all frozen curricula
  IF public.has_role(v_effective_user, 'admin') THEN
    RETURN QUERY
    SELECT
      c.id as curriculum_id,
      true as has_learning_course,
      true as has_exam_trainer,
      true as has_ai_tutor,
      true as has_oral_trainer,
      (now() + interval '1 year')::timestamptz as valid_until
    FROM public.curricula c
    WHERE c.status = 'frozen'
      AND (p_curriculum_id IS NULL OR c.id = p_curriculum_id);
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    e.curriculum_id,
    bool_or(e.has_learning_course) as has_learning_course,
    bool_or(e.has_exam_trainer) as has_exam_trainer,
    bool_or(e.has_ai_tutor) as has_ai_tutor,
    bool_or(e.has_oral_trainer) as has_oral_trainer,
    max(e.valid_until) as valid_until
  FROM public.entitlements e
  WHERE e.user_id = p_user_id
    AND e.valid_until > now()
    AND (p_curriculum_id IS NULL OR e.curriculum_id = p_curriculum_id)
  GROUP BY e.curriculum_id;
END;
$$;
