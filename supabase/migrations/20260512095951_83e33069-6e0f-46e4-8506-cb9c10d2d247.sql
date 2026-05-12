GRANT EXECUTE ON FUNCTION public.fn_is_bronze_locked(uuid) TO supabase_read_only_user;
GRANT SELECT ON public.v_publish_readiness_gate TO supabase_read_only_user;