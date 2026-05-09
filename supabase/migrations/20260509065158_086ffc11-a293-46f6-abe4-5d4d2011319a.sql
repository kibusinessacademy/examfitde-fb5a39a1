
REVOKE ALL ON FUNCTION public.fn_reap_stale_processing_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reap_stale_processing_jobs(integer) TO service_role;
