
-- =============================================
-- FIX 1: course_quality_audits — restrict to admin only
-- =============================================
DROP POLICY IF EXISTS "Allow read for all" ON public.course_quality_audits;

CREATE POLICY "admin_only_select_quality_audits"
ON public.course_quality_audits FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Ensure write policies are also admin-only
CREATE POLICY "admin_only_insert_quality_audits"
ON public.course_quality_audits FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin_only_update_quality_audits"
ON public.course_quality_audits FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin_only_delete_quality_audits"
ON public.course_quality_audits FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- =============================================
-- FIX 2: Add admin role checks to SECURITY DEFINER functions
-- =============================================

-- admin_approve_growth_action
CREATE OR REPLACE FUNCTION public.admin_approve_growth_action(p_action_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  UPDATE public.growth_actions
  SET status = 'approved', updated_at = now()
  WHERE id = p_action_id;
END $function$;

-- admin_dismiss_growth_action
CREATE OR REPLACE FUNCTION public.admin_dismiss_growth_action(p_action_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  UPDATE public.growth_actions
  SET status = 'dismissed', updated_at = now()
  WHERE id = p_action_id;
END $function$;

-- admin_block_user
CREATE OR REPLACE FUNCTION public.admin_block_user(p_user_id uuid, p_until timestamp with time zone DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  INSERT INTO public.security_blocks(user_id, blocked_until, reason)
  VALUES (p_user_id, p_until, p_reason)
  ON CONFLICT (user_id)
  DO UPDATE SET blocked_until = EXCLUDED.blocked_until, reason = EXCLUDED.reason, updated_at = now();

  INSERT INTO public.security_events(event_type, user_id, decision, reason, meta)
  VALUES ('admin_block', p_user_id, 'block', p_reason, jsonb_build_object('blocked_until', p_until));
END $function$;

-- admin_unblock_user
CREATE OR REPLACE FUNCTION public.admin_unblock_user(p_user_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  DELETE FROM public.security_blocks WHERE user_id = p_user_id;
  INSERT INTO public.security_events(event_type, user_id, decision, reason)
  VALUES ('admin_unblock', p_user_id, 'allow', p_reason);
END $function$;

-- admin_reset_code_lockout
CREATE OR REPLACE FUNCTION public.admin_reset_code_lockout(p_code text, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  DELETE FROM public.license_code_lockouts WHERE license_code = upper(trim(p_code));
  INSERT INTO public.security_events(event_type, license_code, decision, reason, meta)
  VALUES ('claim_locked', upper(trim(p_code)), 'allow', 'admin_reset_code_lockout', jsonb_build_object('note', p_note));
END $function$;

-- admin_decide_security_review
CREATE OR REPLACE FUNCTION public.admin_decide_security_review(p_review_id uuid, p_status security_review_status, p_note text DEFAULT NULL, p_block_until timestamp with time zone DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_user uuid; v_code text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  SELECT user_id, license_code INTO v_user, v_code
  FROM public.security_reviews WHERE id = p_review_id;

  UPDATE public.security_reviews
  SET status = p_status, decided_by = auth.uid(), decided_at = now(),
      decision_note = p_note, updated_at = now()
  WHERE id = p_review_id;

  IF p_status = 'blocked' AND v_user IS NOT NULL THEN
    PERFORM public.admin_block_user(v_user, p_block_until, COALESCE(p_note,'security_review_block'));
  END IF;
END $function$;
