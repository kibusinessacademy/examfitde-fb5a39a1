-- Harden RPC permissions: only service_role may call these
REVOKE ALL ON FUNCTION public.count_questions_by_lf(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_questions_by_lf(uuid, uuid[]) TO service_role;

REVOKE ALL ON FUNCTION public.heavy_processing_per_package(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.heavy_processing_per_package(text[]) TO service_role;