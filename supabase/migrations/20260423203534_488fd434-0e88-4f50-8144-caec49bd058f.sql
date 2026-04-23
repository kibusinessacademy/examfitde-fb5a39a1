GRANT EXECUTE ON FUNCTION public.admin_check_heal_conflicts(UUID, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_step_reset_detailed(UUID, TEXT[], TEXT, TEXT, BOOLEAN, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_manual_heal_package_v2(UUID, TEXT[], TEXT, BOOLEAN, TEXT[], TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_rollback_heal(UUID, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_auto_repair_limit_status(UUID, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.analyze_package_root_cause(UUID) TO service_role;