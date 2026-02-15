
-- Fix renew_package_lease: table has (package_id, locked_at), no locked_by/expires_at
-- Drop existing function with boolean return type first
DROP FUNCTION IF EXISTS public.renew_package_lease(uuid, text, integer);

CREATE OR REPLACE FUNCTION public.renew_package_lease(
  p_package_id uuid,
  p_runner_id text,
  p_lease_seconds int DEFAULT 600
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.course_package_locks
  SET locked_at = now()
  WHERE package_id = p_package_id;
$$;

-- Release: just delete the lock row
DROP FUNCTION IF EXISTS public.release_package_lease(uuid, text);

CREATE OR REPLACE FUNCTION public.release_package_lease(
  p_package_id uuid,
  p_runner_id text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.course_package_locks
  WHERE package_id = p_package_id;
$$;
