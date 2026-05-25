-- Phase 7b: Cooldown + Admin RPCs

ALTER TABLE public.organization_profession_licenses
  ADD COLUMN IF NOT EXISTS last_primary_switch_at timestamptz,
  ADD COLUMN IF NOT EXISTS primary_switch_cooldown_until timestamptz;

-- Cooldown-aware primary switch
CREATE OR REPLACE FUNCTION public.admin_switch_primary_profession(
  _organization_id uuid,
  _new_profession_id text,
  _force boolean DEFAULT false,
  _cooldown_days int DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current record;
  v_target record;
  v_now timestamptz := now();
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'support')) THEN
    RAISE EXCEPTION 'forbidden: admin or support required';
  END IF;

  SELECT * INTO v_current
  FROM public.organization_profession_licenses
  WHERE organization_id = _organization_id
    AND is_primary = true
    AND status = 'active'
  LIMIT 1;

  SELECT * INTO v_target
  FROM public.organization_profession_licenses
  WHERE organization_id = _organization_id
    AND profession_id = _new_profession_id
  LIMIT 1;

  IF v_target.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'target_license_missing');
  END IF;

  IF v_current.id IS NOT NULL
     AND v_current.profession_id = _new_profession_id THEN
    RETURN jsonb_build_object('ok', true, 'reason', 'noop_already_primary');
  END IF;

  IF NOT _force
     AND v_current.primary_switch_cooldown_until IS NOT NULL
     AND v_current.primary_switch_cooldown_until > v_now THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'cooldown_active',
      'cooldown_until', v_current.primary_switch_cooldown_until
    );
  END IF;

  -- Demote current
  IF v_current.id IS NOT NULL THEN
    UPDATE public.organization_profession_licenses
       SET is_primary = false
     WHERE id = v_current.id;
  END IF;

  -- Promote new + set cooldown
  UPDATE public.organization_profession_licenses
     SET is_primary = true,
         status = 'active',
         last_primary_switch_at = v_now,
         primary_switch_cooldown_until = v_now + make_interval(days => GREATEST(_cooldown_days, 0))
   WHERE id = v_target.id;

  -- Audit
  INSERT INTO public.profession_guard_events(
    organization_id, profession_id, agent_id, workflow_slug,
    allowed, reason, actor_id, metadata
  ) VALUES (
    _organization_id, _new_profession_id, NULL, NULL,
    true, 'primary_switch', auth.uid(),
    jsonb_build_object(
      'from', v_current.profession_id,
      'to', _new_profession_id,
      'forced', _force,
      'cooldown_days', _cooldown_days
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'from', v_current.profession_id,
    'to', _new_profession_id,
    'cooldown_until', v_now + make_interval(days => GREATEST(_cooldown_days, 0))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_switch_primary_profession(uuid, text, boolean, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_switch_primary_profession(uuid, text, boolean, int) TO authenticated;

-- List profession contexts (admin)
CREATE OR REPLACE FUNCTION public.admin_list_profession_contexts()
RETURNS TABLE (
  profession_id text,
  profession_name text,
  allowed_agent_slugs text[],
  allowed_agent_categories text[],
  allowed_workflow_categories text[],
  governance_profile jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'support')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT pc.profession_id, pc.profession_name,
         pc.allowed_agent_slugs, pc.allowed_agent_categories,
         pc.allowed_workflow_categories, pc.governance_profile,
         pc.created_at, pc.updated_at
  FROM public.profession_contexts pc
  ORDER BY pc.profession_name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_profession_contexts() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_profession_contexts() TO authenticated;

-- List orgs with license summary
CREATE OR REPLACE FUNCTION public.admin_list_orgs_with_licenses(_limit int DEFAULT 200)
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  primary_profession_id text,
  primary_profession_name text,
  primary_tier text,
  addon_count int,
  cooldown_until timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'support')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT
    o.id,
    COALESCE(o.name, 'Unbenannt'),
    pri.profession_id,
    pc.profession_name,
    pri.tier::text,
    COALESCE((
      SELECT COUNT(*)::int FROM public.organization_profession_licenses l2
      WHERE l2.organization_id = o.id AND l2.is_primary = false AND l2.status = 'active'
    ), 0),
    pri.primary_switch_cooldown_until
  FROM public.organizations o
  LEFT JOIN LATERAL (
    SELECT * FROM public.organization_profession_licenses l
    WHERE l.organization_id = o.id AND l.is_primary = true AND l.status = 'active'
    LIMIT 1
  ) pri ON true
  LEFT JOIN public.profession_contexts pc ON pc.profession_id = pri.profession_id
  ORDER BY (pri.profession_id IS NULL), o.name
  LIMIT _limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_orgs_with_licenses(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_orgs_with_licenses(int) TO authenticated;

-- Deny events feed
CREATE OR REPLACE FUNCTION public.admin_list_profession_guard_events(
  _organization_id uuid DEFAULT NULL,
  _only_denied boolean DEFAULT true,
  _limit int DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  profession_id text,
  agent_id uuid,
  workflow_slug text,
  allowed boolean,
  reason text,
  actor_id uuid,
  metadata jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'support')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT e.id, e.organization_id, e.profession_id, e.agent_id, e.workflow_slug,
         e.allowed, e.reason, e.actor_id, e.metadata, e.created_at
  FROM public.profession_guard_events e
  WHERE (_organization_id IS NULL OR e.organization_id = _organization_id)
    AND (NOT _only_denied OR e.allowed = false)
  ORDER BY e.created_at DESC
  LIMIT _limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_profession_guard_events(uuid, boolean, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_profession_guard_events(uuid, boolean, int) TO authenticated;

-- Seed profession contexts (idempotent UPSERT via existing admin_upsert_profession_context)
DO $$
BEGIN
  PERFORM public.admin_upsert_profession_context(
    'fachinformatiker_systemintegration',
    'Fachinformatiker Systemintegration',
    ARRAY['communication','workflow','analysis','compliance']::text[],
    ARRAY['communication','workflow','analysis','compliance','operations']::text[],
    ARRAY['kommunikation','analyse','dokumentation','organisation','fach']::text[],
    jsonb_build_object('risk_profile','medium','hitl_required',true,'data_class','customer_internal')
  );
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$
BEGIN
  PERFORM public.admin_upsert_profession_context(
    'industriekaufmann',
    'Industriekaufmann/-frau',
    ARRAY['communication','workflow','analysis']::text[],
    ARRAY['communication','workflow','analysis','operations']::text[],
    ARRAY['kommunikation','analyse','dokumentation','organisation','fach']::text[],
    jsonb_build_object('risk_profile','low','hitl_required',false,'data_class','customer_internal')
  );
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$
BEGIN
  PERFORM public.admin_upsert_profession_context(
    'bilanzbuchhalter',
    'Bilanzbuchhalter',
    ARRAY['compliance','analysis','workflow']::text[],
    ARRAY['compliance','analysis','workflow']::text[],
    ARRAY['analyse','dokumentation','fach']::text[],
    jsonb_build_object('risk_profile','high','hitl_required',true,'data_class','regulated_financial')
  );
EXCEPTION WHEN OTHERS THEN NULL; END $$;
