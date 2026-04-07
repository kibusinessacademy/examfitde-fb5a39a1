
-- Drop the OLD overload with wrong parameter order (p_runner_id, p_lease_seconds, p_track)
-- Keep the CORRECT one (p_runner_id, p_track, p_lease_seconds) with 600s default
DROP FUNCTION IF EXISTS public.acquire_next_package_lease_v2(text, integer, text);
