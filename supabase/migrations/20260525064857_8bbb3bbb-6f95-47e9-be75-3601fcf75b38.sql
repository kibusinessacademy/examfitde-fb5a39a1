
-- Phase 2: SSOT bindings (singular primary refs)
ALTER TABLE public.berufs_ki_workflow_definitions
  ADD COLUMN IF NOT EXISTS competency_id uuid,
  ADD COLUMN IF NOT EXISTS blueprint_id uuid;

CREATE INDEX IF NOT EXISTS idx_berufs_ki_wfd_competency
  ON public.berufs_ki_workflow_definitions (competency_id) WHERE competency_id IS NOT NULL;

-- Tier check RPC (used by edge function)
CREATE OR REPLACE FUNCTION public.berufs_ki_user_can_run(
  p_user_id uuid,
  p_workflow_id uuid
)
RETURNS TABLE(allowed boolean, reason text, tier_required text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier text;
  v_curriculum uuid;
  v_active boolean;
  v_has_access boolean;
BEGIN
  SELECT tier_required, curriculum_id, is_active
    INTO v_tier, v_curriculum, v_active
    FROM public.berufs_ki_workflow_definitions
   WHERE id = p_workflow_id;

  IF v_tier IS NULL THEN
    RETURN QUERY SELECT false, 'workflow_not_found'::text, NULL::text;
    RETURN;
  END IF;

  IF NOT v_active THEN
    RETURN QUERY SELECT false, 'workflow_inactive'::text, v_tier;
    RETURN;
  END IF;

  -- Free tier: always allowed (rate limit handled in edge)
  IF v_tier = 'free' THEN
    RETURN QUERY SELECT true, 'free_tier'::text, v_tier;
    RETURN;
  END IF;

  -- Admin / business role bypass
  IF public.has_role(p_user_id, 'admin') THEN
    RETURN QUERY SELECT true, 'admin_bypass'::text, v_tier;
    RETURN;
  END IF;

  -- Pro / business: require active grant on bound curriculum, or any active grant if unbound
  IF v_curriculum IS NOT NULL THEN
    SELECT public.check_product_access_by_curriculum(p_user_id, v_curriculum, NULL)
      INTO v_has_access;
    IF COALESCE(v_has_access, false) THEN
      RETURN QUERY SELECT true, 'curriculum_grant'::text, v_tier;
      RETURN;
    END IF;
    RETURN QUERY SELECT false, 'entitlement_missing_curriculum'::text, v_tier;
    RETURN;
  END IF;

  -- Unbound pro/business workflow: any active grant suffices
  SELECT EXISTS (
    SELECT 1 FROM public.learner_course_grants
     WHERE user_id = p_user_id
       AND status = 'active'
       AND (valid_until IS NULL OR valid_until > now())
  ) INTO v_has_access;

  IF v_has_access THEN
    RETURN QUERY SELECT true, 'any_active_grant'::text, v_tier;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, 'entitlement_missing'::text, v_tier;
END;
$$;

REVOKE ALL ON FUNCTION public.berufs_ki_user_can_run(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.berufs_ki_user_can_run(uuid, uuid) TO authenticated, service_role;

-- Admin-facing list with run stats
CREATE OR REPLACE FUNCTION public.admin_berufs_ki_list_workflows()
RETURNS TABLE(
  id uuid,
  slug text,
  title text,
  description text,
  category text,
  tier_required text,
  risk_level text,
  curriculum_id uuid,
  competency_id uuid,
  learning_field_id uuid,
  blueprint_id uuid,
  is_active boolean,
  version int,
  runs_total bigint,
  runs_24h bigint,
  ok_rate numeric,
  last_run_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    w.id, w.slug, w.title, w.description, w.category, w.tier_required, w.risk_level,
    w.curriculum_id, w.competency_id, w.learning_field_id, w.blueprint_id,
    w.is_active, w.version,
    COALESCE(s.runs_total, 0) AS runs_total,
    COALESCE(s.runs_24h, 0) AS runs_24h,
    COALESCE(s.ok_rate, 0)::numeric AS ok_rate,
    s.last_run_at,
    w.updated_at
  FROM public.berufs_ki_workflow_definitions w
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*) AS runs_total,
      COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours') AS runs_24h,
      AVG(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok_rate,
      MAX(created_at) AS last_run_at
    FROM public.berufs_ki_workflow_runs r
    WHERE r.workflow_id = w.id
  ) s ON true
  ORDER BY w.is_active DESC, w.category, w.title;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_berufs_ki_list_workflows() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_berufs_ki_list_workflows() TO authenticated;
