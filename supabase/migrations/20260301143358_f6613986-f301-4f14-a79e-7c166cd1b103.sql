-- Fix: Drop the old 3-param overload that causes ambiguity
-- Keep only the 4-param version with p_reason default
DROP FUNCTION IF EXISTS public.cancel_jobs_for_package(uuid, text, text[]);
