
-- =============================================
-- Admin Test Access: RPC-Erweiterung
-- Admins erhalten virtuellen Vollzugriff auf alle Features
-- Kein UI-Bypass, kein Fake-Kauf, keine KPI-Verfälschung
-- =============================================

-- 1) check_user_entitlement: Admin = immer true
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
BEGIN
  -- Admin bypass: full access to all features for testing
  IF public.has_role(p_user_id, 'admin') THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.entitlements
    WHERE user_id = p_user_id
    AND curriculum_id = p_curriculum_id
    AND valid_until > now()
    AND (
      (p_feature = 'learning_course' AND has_learning_course = true) OR
      (p_feature = 'exam_trainer' AND has_exam_trainer = true) OR
      (p_feature = 'ai_tutor' AND has_ai_tutor = true) OR
      (p_feature = 'oral_trainer' AND has_oral_trainer = true)
    )
  );
END;
$$;

-- 2) get_user_entitlements: Admin sieht alle Curricula mit vollen Features
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
BEGIN
  -- Admin bypass: return full entitlements for all published curricula
  IF public.has_role(p_user_id, 'admin') THEN
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
