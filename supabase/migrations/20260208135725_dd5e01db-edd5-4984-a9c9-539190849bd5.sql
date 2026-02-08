-- Fix security warnings

-- 1. Fix search_path for functions that don't have it set
ALTER FUNCTION public.calculate_product_price(UUID, INTEGER) SET search_path = public;
ALTER FUNCTION public.generate_invite_code() SET search_path = public;
ALTER FUNCTION public.claim_license_seat(TEXT) SET search_path = public;

-- 2. Fix overly permissive RLS policy for license_packages INSERT
-- Replace with service-role only insert (via Edge Function)
DROP POLICY IF EXISTS "System can insert packages" ON public.license_packages;

-- Create a more restrictive insert policy - only via RPC/service role
-- Users cannot directly insert, only via checkout edge function
CREATE POLICY "Service role can insert packages"
  ON public.license_packages FOR INSERT
  WITH CHECK (false); -- Block direct inserts, use service role in edge function