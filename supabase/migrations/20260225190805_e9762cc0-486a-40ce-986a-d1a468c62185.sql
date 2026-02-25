-- Harden RPC grants: restrict to service_role only
REVOKE EXECUTE ON FUNCTION public.count_active_jobs(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_active_jobs(uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.cancel_jobs_for_package(uuid, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_jobs_for_package(uuid, text, text[]) TO service_role;