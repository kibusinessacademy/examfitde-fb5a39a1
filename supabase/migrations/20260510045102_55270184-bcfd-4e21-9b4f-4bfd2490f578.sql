CREATE OR REPLACE FUNCTION public._tmp_handbook_systemwide_backfill()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dry jsonb; v_apply jsonb;
  v_drift_after_pkgs integer; v_pending_after integer;
  v_summary jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SELECT public.admin_backfill_publishable_handbook_chapters(true,  NULL) INTO v_dry;
  SELECT public.admin_backfill_publishable_handbook_chapters(false, NULL) INTO v_apply;

  SELECT COUNT(*), COALESCE(SUM(publishable_count - published_count), 0)
    INTO v_drift_after_pkgs, v_pending_after
    FROM public.v_handbook_publish_drift_alerts;

  v_summary := jsonb_build_object(
    'dry_run', v_dry, 'apply', v_apply,
    'drift_packages_after', v_drift_after_pkgs,
    'pending_chapters_after', v_pending_after,
    'ts', now()
  );

  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES ('handbook_systemwide_backfill_run', 'system',
    CASE WHEN v_drift_after_pkgs = 0 AND v_pending_after = 0 THEN 'success' ELSE 'partial' END,
    v_summary);
  RETURN v_summary;
END $$;

SELECT public._tmp_handbook_systemwide_backfill();
DROP FUNCTION IF EXISTS public._tmp_handbook_systemwide_backfill();