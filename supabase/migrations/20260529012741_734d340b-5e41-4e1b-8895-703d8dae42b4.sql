-- Fix Data-API 400s on orders + llm_provider_cooldowns (Audit D6, 2026-05-29)
-- Both tables had RLS enabled but ZERO grants to authenticated/anon → PostgREST permission denied.
-- Admin UI (FinancePanel, HealthTab, CrmDealsDrilldown, BatchActionsCard, useCommandData) reads them
-- via the supabase JS client → requires authenticated SELECT + RLS policy for admins.

-- orders: keep user-owned SELECT, add admin SELECT
GRANT SELECT ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;

DROP POLICY IF EXISTS "Admins can view all orders" ON public.orders;
CREATE POLICY "Admins can view all orders"
ON public.orders FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- llm_provider_cooldowns: admin-only read (ops cockpit)
GRANT SELECT ON public.llm_provider_cooldowns TO authenticated;
GRANT ALL ON public.llm_provider_cooldowns TO service_role;

DROP POLICY IF EXISTS "Admins can view cooldowns" ON public.llm_provider_cooldowns;
CREATE POLICY "Admins can view cooldowns"
ON public.llm_provider_cooldowns FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));