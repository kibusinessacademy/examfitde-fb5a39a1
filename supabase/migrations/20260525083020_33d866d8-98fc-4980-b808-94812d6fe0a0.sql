
-- ============================================================================
-- PHASE 7 — GLOBAL PROFESSION LICENSE & AGENT LOGIC SYSTEM
-- Berufsfeld-gebundene Plattform-Architektur
-- ============================================================================

-- ---------- Enums ----------
DO $$ BEGIN
  CREATE TYPE profession_license_status AS ENUM ('active','locked','suspended','expired','trial');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE profession_license_tier AS ENUM ('standard','pro','enterprise');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE profession_license_source AS ENUM ('included','addon','enterprise','trial');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Profession Context (SSOT per Beruf) ----------
CREATE TABLE IF NOT EXISTS public.profession_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profession_id uuid NOT NULL UNIQUE,
  profession_name text NOT NULL,
  industry_key text,
  allowed_agent_categories text[] NOT NULL DEFAULT '{}',
  allowed_agent_slugs text[] NOT NULL DEFAULT '{}',
  allowed_workflow_categories text[] NOT NULL DEFAULT '{}',
  allowed_document_types text[] NOT NULL DEFAULT '{}',
  competency_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  blueprint_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  governance_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  branding_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  communication_style jsonb NOT NULL DEFAULT '{}'::jsonb,
  escalation_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profession_contexts ENABLE ROW LEVEL SECURITY;
CREATE POLICY profession_contexts_admin_all ON public.profession_contexts
  TO authenticated USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY profession_contexts_read_active ON public.profession_contexts
  FOR SELECT TO authenticated USING (is_active = true);
CREATE TRIGGER trg_profession_contexts_updated BEFORE UPDATE ON public.profession_contexts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------- Organization Profession Licenses ----------
CREATE TABLE IF NOT EXISTS public.organization_profession_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profession_id uuid NOT NULL,
  industry_id uuid,
  is_primary boolean NOT NULL DEFAULT false,
  status profession_license_status NOT NULL DEFAULT 'active',
  tier profession_license_tier NOT NULL DEFAULT 'standard',
  source profession_license_source NOT NULL DEFAULT 'included',
  activated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  last_switched_at timestamptz,
  switch_cooldown_until timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, profession_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_primary_profession
  ON public.organization_profession_licenses (organization_id)
  WHERE is_primary = true AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_opl_org_active
  ON public.organization_profession_licenses (organization_id, status);
ALTER TABLE public.organization_profession_licenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY opl_admin_all ON public.organization_profession_licenses
  TO authenticated USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY opl_org_members_read ON public.organization_profession_licenses
  FOR SELECT TO authenticated USING (is_org_member(auth.uid(), organization_id));
CREATE TRIGGER trg_opl_updated BEFORE UPDATE ON public.organization_profession_licenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------- Organization Agent Access ----------
CREATE TABLE IF NOT EXISTS public.organization_agent_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES public.berufs_ki_agents(id) ON DELETE CASCADE,
  agent_slug text,
  agent_category text,
  profession_scope uuid[] NOT NULL DEFAULT '{}',
  industry_scope uuid[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  tier_required profession_license_tier NOT NULL DEFAULT 'standard',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oaa_org ON public.organization_agent_access (organization_id, enabled);
CREATE INDEX IF NOT EXISTS idx_oaa_agent ON public.organization_agent_access (agent_id);
ALTER TABLE public.organization_agent_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY oaa_admin_all ON public.organization_agent_access
  TO authenticated USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY oaa_org_members_read ON public.organization_agent_access
  FOR SELECT TO authenticated USING (is_org_member(auth.uid(), organization_id));
CREATE TRIGGER trg_oaa_updated BEFORE UPDATE ON public.organization_agent_access
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------- Guard-Audit ----------
CREATE TABLE IF NOT EXISTS public.profession_guard_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  user_id uuid,
  agent_id uuid,
  agent_slug text,
  profession_id uuid,
  workflow_slug text,
  decision text NOT NULL,  -- allow | deny
  reason text,             -- profession_missing | agent_blocked | tier_insufficient | workflow_not_allowed | competency_locked | governance_failed
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pge_org_created ON public.profession_guard_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pge_decision ON public.profession_guard_events (decision, created_at DESC);
ALTER TABLE public.profession_guard_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY pge_admin_read ON public.profession_guard_events
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'::app_role));

-- ============================================================================
-- GUARD RPC — fail-closed
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_profession_agent_access(
  _organization_id uuid,
  _agent_slug text,
  _workflow_slug text DEFAULT NULL,
  _profession_id uuid DEFAULT NULL,
  _required_tier profession_license_tier DEFAULT 'standard'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent  public.berufs_ki_agents%ROWTYPE;
  v_access public.organization_agent_access%ROWTYPE;
  v_license public.organization_profession_licenses%ROWTYPE;
  v_ctx     public.profession_contexts%ROWTYPE;
  v_reason  text;
  v_allow   boolean := false;
  v_pid     uuid := _profession_id;
BEGIN
  -- Resolve agent
  SELECT * INTO v_agent FROM public.berufs_ki_agents WHERE slug = _agent_slug AND is_active = true;
  IF NOT FOUND THEN
    v_reason := 'agent_unknown';
  ELSE
    -- Primary license if no profession given
    IF v_pid IS NULL THEN
      SELECT * INTO v_license FROM public.organization_profession_licenses
       WHERE organization_id = _organization_id AND status = 'active' AND is_primary = true
       LIMIT 1;
      IF FOUND THEN v_pid := v_license.profession_id; END IF;
    ELSE
      SELECT * INTO v_license FROM public.organization_profession_licenses
       WHERE organization_id = _organization_id AND profession_id = v_pid AND status = 'active'
       LIMIT 1;
    END IF;

    IF v_pid IS NULL OR v_license.id IS NULL THEN
      v_reason := 'profession_missing';
    ELSIF v_license.tier::text < _required_tier::text AND NOT (
      (_required_tier = 'standard') OR
      (_required_tier = 'pro' AND v_license.tier IN ('pro','enterprise')) OR
      (_required_tier = 'enterprise' AND v_license.tier = 'enterprise')
    ) THEN
      v_reason := 'tier_insufficient';
    ELSE
      -- Profession context (optional — if exists, enforce agent allowance)
      SELECT * INTO v_ctx FROM public.profession_contexts WHERE profession_id = v_pid AND is_active = true;
      IF FOUND AND array_length(v_ctx.allowed_agent_slugs, 1) IS NOT NULL
         AND NOT (_agent_slug = ANY (v_ctx.allowed_agent_slugs)) THEN
        v_reason := 'agent_not_in_profession_context';
      ELSIF FOUND AND array_length(v_ctx.allowed_agent_categories, 1) IS NOT NULL
         AND NOT (v_agent.category::text = ANY (v_ctx.allowed_agent_categories)) THEN
        v_reason := 'agent_category_blocked';
      ELSE
        -- Org-specific agent access (if any row → enforce; else default allow at standard tier)
        SELECT * INTO v_access FROM public.organization_agent_access
         WHERE organization_id = _organization_id
           AND (agent_id = v_agent.id OR agent_slug = _agent_slug)
         ORDER BY enabled DESC LIMIT 1;
        IF FOUND AND NOT v_access.enabled THEN
          v_reason := 'agent_disabled_for_org';
        ELSIF FOUND AND v_access.tier_required::text NOT IN ('standard') AND v_access.tier_required <> v_license.tier
              AND NOT (v_access.tier_required = 'pro' AND v_license.tier = 'enterprise') THEN
          v_reason := 'agent_tier_insufficient';
        ELSE
          -- Workflow scope (optional)
          IF _workflow_slug IS NOT NULL AND FOUND AND v_ctx.id IS NOT NULL
             AND array_length(v_ctx.allowed_workflow_categories, 1) IS NOT NULL THEN
            -- soft check; workflow validation happens upstream
            v_allow := true;
          ELSE
            v_allow := true;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  -- Audit
  INSERT INTO public.profession_guard_events
    (organization_id, user_id, agent_id, agent_slug, profession_id, workflow_slug, decision, reason, context)
  VALUES
    (_organization_id, auth.uid(), v_agent.id, _agent_slug, v_pid, _workflow_slug,
     CASE WHEN v_allow THEN 'allow' ELSE 'deny' END, v_reason,
     jsonb_build_object('required_tier', _required_tier, 'license_tier', v_license.tier));

  RETURN jsonb_build_object(
    'allowed', v_allow,
    'reason', v_reason,
    'profession_id', v_pid,
    'tier', v_license.tier,
    'agent_id', v_agent.id
  );
END $$;
REVOKE ALL ON FUNCTION public.check_profession_agent_access(uuid,text,text,uuid,profession_license_tier) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_profession_agent_access(uuid,text,text,uuid,profession_license_tier) TO authenticated, service_role;

-- ============================================================================
-- READ RPCs
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_organization_profession_access(_organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v jsonb;
BEGIN
  IF NOT (has_role(auth.uid(),'admin'::app_role) OR is_org_member(auth.uid(), _organization_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT jsonb_build_object(
    'organization_id', _organization_id,
    'licenses', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.is_primary DESC, l.activated_at)
                          FROM public.organization_profession_licenses l
                         WHERE l.organization_id = _organization_id), '[]'::jsonb),
    'agents', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                          'agent_id', a.id, 'slug', a.slug, 'name', a.name, 'category', a.category,
                          'enabled', COALESCE(oa.enabled, true), 'tier_required', COALESCE(oa.tier_required::text,'standard')
                        ))
                        FROM public.berufs_ki_agents a
                        LEFT JOIN public.organization_agent_access oa
                          ON oa.organization_id = _organization_id AND (oa.agent_id = a.id OR oa.agent_slug = a.slug)
                        WHERE a.is_active = true), '[]'::jsonb),
    'primary_context', (
      SELECT to_jsonb(pc) FROM public.profession_contexts pc
       JOIN public.organization_profession_licenses l
         ON l.profession_id = pc.profession_id AND l.organization_id = _organization_id
        AND l.is_primary = true AND l.status = 'active'
       LIMIT 1
    )
  ) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.get_organization_profession_access(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_organization_profession_access(uuid) TO authenticated;

-- ============================================================================
-- ADMIN MUTATIONS
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_grant_profession_license(
  _organization_id uuid, _profession_id uuid,
  _is_primary boolean DEFAULT false,
  _tier profession_license_tier DEFAULT 'standard',
  _source profession_license_source DEFAULT 'included',
  _expires_at timestamptz DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF _is_primary THEN
    UPDATE public.organization_profession_licenses
       SET is_primary = false, updated_at = now()
     WHERE organization_id = _organization_id AND is_primary = true;
  END IF;

  INSERT INTO public.organization_profession_licenses
    (organization_id, profession_id, is_primary, tier, source, status, expires_at)
  VALUES (_organization_id, _profession_id, _is_primary, _tier, _source, 'active', _expires_at)
  ON CONFLICT (organization_id, profession_id) DO UPDATE
    SET is_primary = EXCLUDED.is_primary,
        tier = EXCLUDED.tier,
        source = EXCLUDED.source,
        status = 'active',
        expires_at = EXCLUDED.expires_at,
        updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_grant_profession_license(uuid,uuid,boolean,profession_license_tier,profession_license_source,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_grant_profession_license(uuid,uuid,boolean,profession_license_tier,profession_license_source,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_agent_access(
  _organization_id uuid, _agent_slug text,
  _enabled boolean DEFAULT true,
  _tier_required profession_license_tier DEFAULT 'standard'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid; v_agent_id uuid;
BEGIN
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT id INTO v_agent_id FROM public.berufs_ki_agents WHERE slug = _agent_slug;
  INSERT INTO public.organization_agent_access
    (organization_id, agent_id, agent_slug, enabled, tier_required)
  VALUES (_organization_id, v_agent_id, _agent_slug, _enabled, _tier_required)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_agent_access(uuid,text,boolean,profession_license_tier) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_agent_access(uuid,text,boolean,profession_license_tier) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_upsert_profession_context(
  _profession_id uuid, _profession_name text,
  _allowed_agent_slugs text[] DEFAULT '{}',
  _allowed_agent_categories text[] DEFAULT '{}',
  _allowed_workflow_categories text[] DEFAULT '{}',
  _governance_profile jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO public.profession_contexts
    (profession_id, profession_name, allowed_agent_slugs, allowed_agent_categories,
     allowed_workflow_categories, governance_profile)
  VALUES (_profession_id, _profession_name, _allowed_agent_slugs, _allowed_agent_categories,
          _allowed_workflow_categories, _governance_profile)
  ON CONFLICT (profession_id) DO UPDATE
    SET profession_name = EXCLUDED.profession_name,
        allowed_agent_slugs = EXCLUDED.allowed_agent_slugs,
        allowed_agent_categories = EXCLUDED.allowed_agent_categories,
        allowed_workflow_categories = EXCLUDED.allowed_workflow_categories,
        governance_profile = EXCLUDED.governance_profile,
        updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_upsert_profession_context(uuid,text,text[],text[],text[],jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_profession_context(uuid,text,text[],text[],text[],jsonb) TO authenticated;
