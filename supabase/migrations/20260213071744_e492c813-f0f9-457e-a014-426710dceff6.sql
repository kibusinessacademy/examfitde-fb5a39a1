
-- ============================================================
-- SECURITY HARDENING: Zero-Trust RLS + Company Hierarchy
-- ============================================================

-- 1) CREATE company_members TABLE for B2B hierarchy
-- ============================================================
CREATE TABLE IF NOT EXISTS public.company_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'manager', 'member')),
  invited_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);

ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

-- Deny anon
CREATE POLICY "deny_anon_company_members"
  ON public.company_members FOR ALL TO anon USING (false);

-- Members can see their own company's members
CREATE POLICY "members_see_own_company"
  ON public.company_members FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.company_members cm2
      WHERE cm2.company_id = company_members.company_id
      AND cm2.user_id = auth.uid()
    )
  );

-- Company admins can manage members
CREATE POLICY "company_admin_manage_members"
  ON public.company_members FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members cm2
      WHERE cm2.company_id = company_members.company_id
      AND cm2.user_id = auth.uid()
      AND cm2.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_members cm2
      WHERE cm2.company_id = company_members.company_id
      AND cm2.user_id = auth.uid()
      AND cm2.role = 'admin'
    )
  );

-- Global admin full access
CREATE POLICY "global_admin_company_members"
  ON public.company_members FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Seed existing company admins into company_members
INSERT INTO public.company_members (company_id, user_id, role)
SELECT c.id, c.admin_user_id, 'admin'
FROM public.companies c
WHERE c.admin_user_id IS NOT NULL
ON CONFLICT (company_id, user_id) DO NOTHING;

-- 2) FIX LICENSE_SEATS: Replace {public} policies with {authenticated}
-- ============================================================

-- Drop old public-role policies
DROP POLICY IF EXISTS "Admins can view all seats" ON public.license_seats;
DROP POLICY IF EXISTS "Buyers can update unassigned seats" ON public.license_seats;
DROP POLICY IF EXISTS "Buyers can view their package seats" ON public.license_seats;
DROP POLICY IF EXISTS "Users can view only their own seat" ON public.license_seats;

-- Deny anon completely
CREATE POLICY "deny_anon_license_seats"
  ON public.license_seats FOR ALL TO anon USING (false);

-- Users see only their own assigned seat
CREATE POLICY "seats_self_select"
  ON public.license_seats FOR SELECT TO authenticated
  USING (assigned_user_id = auth.uid());

-- Package buyers see their seats
CREATE POLICY "seats_buyer_select"
  ON public.license_seats FOR SELECT TO authenticated
  USING (
    auth.uid() IN (
      SELECT lp.buyer_user_id FROM public.license_packages lp
      WHERE lp.id = license_seats.package_id
    )
  );

-- Package buyers can update unassigned seats
CREATE POLICY "seats_buyer_update"
  ON public.license_seats FOR UPDATE TO authenticated
  USING (
    auth.uid() IN (
      SELECT lp.buyer_user_id FROM public.license_packages lp
      WHERE lp.id = license_seats.package_id
    )
  )
  WITH CHECK (
    auth.uid() IN (
      SELECT lp.buyer_user_id FROM public.license_packages lp
      WHERE lp.id = license_seats.package_id
    )
  );

-- Company admins can view seats for their company's packages
CREATE POLICY "seats_company_admin_select"
  ON public.license_seats FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.license_packages lp
      JOIN public.company_members cm ON cm.company_id = lp.company_id
      WHERE lp.id = license_seats.package_id
      AND cm.user_id = auth.uid()
      AND cm.role = 'admin'
    )
  );

-- Global admin full access
CREATE POLICY "seats_global_admin"
  ON public.license_seats FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 3) COMPANIES: Add company_members based access
-- ============================================================

-- Company members can view their company
CREATE POLICY "company_member_select"
  ON public.companies FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members cm
      WHERE cm.company_id = companies.id
      AND cm.user_id = auth.uid()
    )
  );

-- 4) CREATE SECURE VIEW: license_seats without sensitive columns
-- ============================================================
CREATE OR REPLACE VIEW public.license_seats_safe AS
SELECT
  id,
  package_id,
  assigned_user_id,
  assigned_at,
  created_at,
  licensee_first_name,
  licensee_last_name
  -- EXCLUDED: invite_code, invite_email, invite_email_hash, claimed_by_ip, claimed_user_agent
FROM public.license_seats;

-- No SECURITY DEFINER on this view - inherits caller's RLS
COMMENT ON VIEW public.license_seats_safe IS 'Safe view excluding invite codes, emails, and IP addresses. Use this for non-admin queries.';
