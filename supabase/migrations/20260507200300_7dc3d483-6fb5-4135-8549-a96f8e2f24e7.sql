GRANT EXECUTE ON FUNCTION public.fn_step_globally_required(text) TO authenticated, postgres;
GRANT EXECUTE ON FUNCTION public.fn_package_has_oral_exam(uuid) TO authenticated, postgres;
GRANT EXECUTE ON FUNCTION public.fn_skip_reason_legitimate(text) TO authenticated, postgres;
GRANT EXECUTE ON FUNCTION public.fn_normalize_track(text) TO authenticated, postgres;
GRANT SELECT ON public.v_phantom_skipped_required_drift TO postgres;