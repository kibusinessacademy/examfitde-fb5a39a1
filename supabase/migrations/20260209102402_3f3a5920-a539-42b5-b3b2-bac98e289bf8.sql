
-- =====================================================
-- FIX 1: license_seats_public_exposure
-- Problem: Buyers can see invite_codes for ALL seats in package
-- Solution: Restrict SELECT to own seat only, buyers see count via edge function
-- =====================================================

-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Users can view their assigned seats" ON public.license_seats;

-- Create policy: Users can ONLY view their own assigned seat
CREATE POLICY "Users can view only their own seat"
ON public.license_seats FOR SELECT
USING (auth.uid() = assigned_user_id);

-- Buyers need a separate, more restricted view via RPC/Edge Function
-- They should NOT see invite_codes of unclaimed seats via direct table access

-- =====================================================
-- FIX 2: Ensure ai_tutor_logs INSERT is properly secured
-- Verify the existing policy is correct (it already restricts to own user_id)
-- =====================================================

-- The existing INSERT policy is correct:
-- "Users can insert their own tutor logs" with with_check:(user_id = auth.uid())
-- No changes needed for ai_tutor_logs

-- =====================================================
-- FIX 3: profiles table - Already secure
-- Existing policy: "Users can view own profile or admins all" 
-- qual:((user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))
-- This is correct - no changes needed
-- =====================================================
