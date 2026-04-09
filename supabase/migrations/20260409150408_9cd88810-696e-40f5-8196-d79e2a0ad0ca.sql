
-- ============================================================
-- FINAL LEGACY CUTOVER: organization_members → org_memberships
-- ============================================================

-- 1. Rewrite is_org_member to use org_memberships
CREATE OR REPLACE FUNCTION public.is_org_member(p_user uuid, p_org uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_memberships m
    WHERE m.user_id = p_user
      AND m.org_id = p_org
      AND m.status = 'active'
  );
$$;

-- 2. Rewrite is_org_member_with_role to use org_memberships
CREATE OR REPLACE FUNCTION public.is_org_member_with_role(p_user uuid, p_org uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_memberships m
    WHERE m.user_id = p_user
      AND m.org_id = p_org
      AND m.role::text = ANY(p_roles)
      AND m.status = 'active'
  );
$$;

-- 3. Rewrite fn_require_org_access to use org_memberships
CREATE OR REPLACE FUNCTION public.fn_require_org_access(
  p_org_id uuid,
  p_roles text[] DEFAULT ARRAY['OWNER','MANAGER','IT_ADMIN','BILLING']
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.org_memberships om
    WHERE om.org_id = p_org_id
      AND om.user_id = auth.uid()
      AND om.role::text = ANY(p_roles)
      AND om.status = 'active'
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED_ORG_ACCESS';
  END IF;
END;
$$;

-- 4. Rebuild org_audit_events RLS to use org_memberships
DROP POLICY IF EXISTS "Org members can view own org audit events" ON public.org_audit_events;
CREATE POLICY "Org members can view own org audit events"
ON public.org_audit_events
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.org_memberships om
    WHERE om.org_id = org_audit_events.org_id
      AND om.user_id = auth.uid()
      AND om.role::text IN ('OWNER','MANAGER','IT_ADMIN')
      AND om.status = 'active'
  )
);

-- 5. Drop all RLS on organization_members (deprecate table)
DROP POLICY IF EXISTS "org_members_select_members" ON public.organization_members;

-- 6. Comment the legacy table as deprecated
COMMENT ON TABLE public.organization_members IS 'DEPRECATED — do not use. SSOT is org_memberships. Will be dropped in a future migration.';

-- 7. Harden handle_new_user to sync email into profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.email
  )
  ON CONFLICT (user_id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, profiles.full_name);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'learner')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;
