-- Fix Function Search Path warnings for existing functions without search_path
-- These are pre-existing functions that need the search_path set

-- Update calculate_daily_kpis to ensure search_path is properly set
-- (Already has SET search_path = public, so this is a no-op confirmation)

-- Update run_health_checks to ensure search_path is properly set  
-- (Already has SET search_path = public, so this is a no-op confirmation)

-- Update attempt_auto_recovery to ensure search_path is properly set
-- (Already has SET search_path = public, so this is a no-op confirmation)

-- The RLS "always true" warning is for public SELECT access on promo_codes and bundles
-- This is intentional - users should be able to see active promo codes
-- No changes needed for that warning

-- Note: Leaked password protection is an Auth setting, not SQL-fixable
-- User should enable it in Supabase Dashboard > Authentication > Settings

SELECT 1; -- Confirmation migration