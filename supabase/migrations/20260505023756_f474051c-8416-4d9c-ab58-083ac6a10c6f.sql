
CREATE OR REPLACE FUNCTION public.admin_seo_canonical_parity_run()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_checked int:=0; v_demoted int:=0; v_ok int:=0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  WITH upd AS (
    UPDATE public.seo_content_pages p
       SET last_canonical_check=now(),
           canonical_check_status=d.drift_severity,
           status=CASE WHEN d.drift_severity='ORPHAN_PUBLISHED' THEN 'draft' ELSE p.status END,
           updated_at=now()
      FROM public.v_seo_canonical_drift d
     WHERE p.id=d.page_id
       AND (p.status='published' OR d.drift_severity='DRAFT_BUT_PKG_LIVE')
    RETURNING d.drift_severity
  )
  SELECT COUNT(*), COUNT(*) FILTER (WHERE drift_severity='ORPHAN_PUBLISHED'), COUNT(*) FILTER (WHERE drift_severity='OK')
    INTO v_checked, v_demoted, v_ok FROM upd;
  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
  VALUES ('seo_canonical_parity_run','system','completed',
          jsonb_build_object('checked',v_checked,'orphan_demoted',v_demoted,'ok',v_ok,'ts',now()));
  RETURN jsonb_build_object('checked',v_checked,'orphan_demoted',v_demoted,'ok',v_ok);
END $$;
REVOKE ALL ON FUNCTION public.admin_seo_canonical_parity_run() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_seo_canonical_parity_run() TO authenticated, service_role;
