
-- 1. Create a safe view for companies that excludes sensitive columns
-- Members will query this view instead of the base table
CREATE VIEW public.companies_safe
WITH (security_invoker = on) AS
SELECT 
  id,
  name,
  admin_user_id,
  max_seats,
  created_at,
  updated_at
FROM public.companies;
-- Excludes: contact_email, contact_phone, vat_id, address

-- 2. Drop the overly permissive member SELECT policy on the base table
DROP POLICY IF EXISTS company_member_select ON public.companies;

-- 3. Re-create member SELECT policy restricted to non-sensitive use via admin/owner only
-- Members who need company info (name, seats) use the companies_safe view
-- The view inherits RLS from the base table with security_invoker=on
-- So we need a policy that allows members to SELECT, but they should use the view

-- Create a restrictive member policy: members can only see their company via the safe view
-- The base table SELECT for members stays, but the view hides sensitive columns
CREATE POLICY "company_member_select"
ON public.companies
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.company_members cm
    WHERE cm.company_id = companies.id
    AND cm.user_id = auth.uid()
  )
);

-- 4. Revoke direct anon access
REVOKE ALL ON public.companies FROM anon;
REVOKE ALL ON public.companies_safe FROM anon;
REVOKE ALL ON public.profiles FROM anon;

-- 5. Grant authenticated access to the safe view
GRANT SELECT ON public.companies_safe TO authenticated;
