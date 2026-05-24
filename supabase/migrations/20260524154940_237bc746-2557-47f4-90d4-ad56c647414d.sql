
-- ============================================================
-- 1) license_seats: restrict buyer SELECT to non-PII via view
-- ============================================================
DROP POLICY IF EXISTS "seats_buyer_select" ON public.license_seats;

-- Buyers may still UPDATE (assign/revoke) and admins/company-admins keep ALL/SELECT.
-- For listing seats, buyers use the view below (PII-free).
CREATE OR REPLACE VIEW public.v_license_seats_buyer_summary
WITH (security_invoker = on) AS
SELECT
  ls.id,
  ls.package_id,
  ls.assigned_user_id IS NOT NULL AS is_assigned,
  ls.assigned_at,
  ls.invite_expires_at,
  ls.created_at,
  CASE
    WHEN ls.assigned_user_id IS NOT NULL THEN 'assigned'
    WHEN ls.invite_email_hash IS NOT NULL AND (ls.invite_expires_at IS NULL OR ls.invite_expires_at > now()) THEN 'invited'
    WHEN ls.invite_email_hash IS NOT NULL AND ls.invite_expires_at <= now() THEN 'expired'
    ELSE 'available'
  END AS seat_status
FROM public.license_seats ls
WHERE EXISTS (
  SELECT 1 FROM public.license_packages lp
  WHERE lp.id = ls.package_id
    AND lp.buyer_user_id = auth.uid()
);

GRANT SELECT ON public.v_license_seats_buyer_summary TO authenticated;

COMMENT ON VIEW public.v_license_seats_buyer_summary IS
  'Buyer-facing summary of license seats — excludes invite_email, names, personnel_number. PII-access only via service_role / admin / company_admin.';

-- ============================================================
-- 2) org_license_invites: SELECT only for org owners/admins
-- ============================================================
DROP POLICY IF EXISTS "Org members can view their org invites" ON public.org_license_invites;

CREATE POLICY "Org admins can view their org invites"
ON public.org_license_invites
FOR SELECT
TO authenticated
USING (
  org_id IN (
    SELECT om.org_id FROM public.org_memberships om
    WHERE om.user_id = auth.uid()
      AND om.role = ANY (ARRAY['owner'::text, 'admin'::text])
      AND om.status = 'active'::text
  )
);

-- ============================================================
-- 3) billing_accounts: SELECT only for OWNER / BILLING
-- ============================================================
DROP POLICY IF EXISTS "billing_accounts_select_members" ON public.billing_accounts;

CREATE POLICY "billing_accounts_select_privileged"
ON public.billing_accounts
FOR SELECT
TO authenticated
USING (
  is_org_member_with_role(auth.uid(), organization_id, ARRAY['OWNER'::text, 'BILLING'::text])
);

-- ============================================================
-- 4) sso_login_events: fix broken INSERT policy
-- ============================================================
DROP POLICY IF EXISTS "Service role inserts SSO events" ON public.sso_login_events;

-- service_role bypasses RLS anyway; this policy documents intent and
-- explicitly denies authenticated/anon inserts (no permissive INSERT policy
-- for non-service roles means inserts from JWT contexts are blocked).
CREATE POLICY "Service role inserts SSO events"
ON public.sso_login_events
FOR INSERT
TO service_role
WITH CHECK (true);

-- ============================================================
-- 5) security_otp_challenges: drop redundant deny-all policy
-- ============================================================
DROP POLICY IF EXISTS "deny_all_security_otp_challenges" ON public.security_otp_challenges;
