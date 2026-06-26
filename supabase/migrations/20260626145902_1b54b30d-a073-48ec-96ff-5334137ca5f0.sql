
-- Fix 1: conversation_os_scenarios — restrict premium content to entitled users
DROP POLICY IF EXISTS conv_os_scn_public_read_published ON public.conversation_os_scenarios;

-- Anon + authenticated may only see non-premium published scenarios
CREATE POLICY conv_os_scn_public_read_nonpremium
ON public.conversation_os_scenarios
FOR SELECT
TO anon, authenticated
USING (status = 'published' AND is_premium = false);

-- Authenticated users with a valid entitlement (for the linked curriculum) may see premium scenarios
CREATE POLICY conv_os_scn_entitled_read_premium
ON public.conversation_os_scenarios
FOR SELECT
TO authenticated
USING (
  status = 'published'
  AND is_premium = true
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.entitlements e
      WHERE e.user_id = auth.uid()
        AND (e.curriculum_id = conversation_os_scenarios.curriculum_id
             OR e.product_id IS NOT NULL)
        AND e.valid_until > now()
    )
  )
);

-- Fix 2: partner_commission_rules — restrict to admins and partners viewing their own rules
DROP POLICY IF EXISTS "Authenticated can read active rules" ON public.partner_commission_rules;

CREATE POLICY partner_commission_rules_admin_read
ON public.partner_commission_rules
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));
