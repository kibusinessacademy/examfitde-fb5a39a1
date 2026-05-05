
-- Re-create what previous migration partially applied (idempotent)
ALTER TABLE public.seo_content_pages
  ADD COLUMN IF NOT EXISTS last_canonical_check timestamptz,
  ADD COLUMN IF NOT EXISTS canonical_check_status text;

CREATE INDEX IF NOT EXISTS idx_seo_content_pages_canonical_check
  ON public.seo_content_pages (last_canonical_check NULLS FIRST)
  WHERE status = 'published';

CREATE OR REPLACE VIEW public.v_seo_canonical_drift AS
WITH base AS (
  SELECT p.id AS page_id, p.package_id, p.slug, p.persona_type,
    p.status AS page_status, p.last_canonical_check, p.canonical_check_status,
    cp.status AS pkg_status, cp.is_published AS pkg_is_published, cp.package_key
  FROM public.seo_content_pages p
  LEFT JOIN public.course_packages cp ON cp.id = p.package_id
)
SELECT page_id, package_id, slug, persona_type, page_status,
  pkg_status, pkg_is_published, package_key,
  last_canonical_check, canonical_check_status,
  CASE
    WHEN page_status='published' AND (pkg_status IS DISTINCT FROM 'published' OR COALESCE(pkg_is_published,false)=false) THEN 'ORPHAN_PUBLISHED'
    WHEN page_status='published' AND last_canonical_check IS NULL THEN 'NEVER_CHECKED'
    WHEN page_status='published' AND last_canonical_check < now() - interval '24 hours' THEN 'STALE_24H'
    WHEN page_status='draft' AND pkg_status='published' AND COALESCE(pkg_is_published,false)=true THEN 'DRAFT_BUT_PKG_LIVE'
    ELSE 'OK'
  END AS drift_severity
FROM base;

REVOKE ALL ON public.v_seo_canonical_drift FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_seo_canonical_drift TO service_role;

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
  INSERT INTO public.auto_heal_log (action_type, target_type, result_status, payload)
  VALUES ('seo_canonical_parity_run','system','completed',
          jsonb_build_object('checked',v_checked,'orphan_demoted',v_demoted,'ok',v_ok,'ts',now()));
  RETURN jsonb_build_object('checked',v_checked,'orphan_demoted',v_demoted,'ok',v_ok);
END $$;
REVOKE ALL ON FUNCTION public.admin_seo_canonical_parity_run() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_seo_canonical_parity_run() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_seo_canonical_drift_summary()
RETURNS TABLE(drift_severity text, page_count bigint)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT drift_severity, COUNT(*)::bigint
    FROM public.v_seo_canonical_drift
   WHERE pg_has_role('service_role','MEMBER') OR public.has_role(auth.uid(),'admin'::app_role)
   GROUP BY drift_severity ORDER BY 1;
$$;
REVOKE ALL ON FUNCTION public.admin_seo_canonical_drift_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_seo_canonical_drift_summary() TO authenticated, service_role;

-- (B) Buy-CTA A/B Experiment (type='frontend')
INSERT INTO public.experiments (name, council_id, type, status, hypothesis, kpi_name, allocation, variants, start_at)
SELECT 'buy_cta_persona_v1', 'manual:sprint-2026-05-05', 'frontend', 'running',
       'Persona-spezifische CTA-Varianten erhöhen checkout_start CTR auf neu-published Cert-Pages',
       'checkout_start_rate',
       jsonb_build_object('A',34,'B',33,'C',33),
       jsonb_build_object(
         'A', jsonb_build_object('label','Jetzt Prüfung trainieren','desc','Control'),
         'B', jsonb_build_object('label','Bestehensgarantie sichern','desc','Outcome-framing'),
         'C', jsonb_build_object('label','In 30 Tagen prüfungsbereit','desc','Time-framing')
       ),
       now()
WHERE NOT EXISTS (SELECT 1 FROM public.experiments WHERE name='buy_cta_persona_v1');

-- (C) Funnel-Dropoff Heatmap
CREATE OR REPLACE VIEW public.v_funnel_dropoff_per_lead_magnet AS
WITH base AS (
  SELECT package_id,
         COALESCE(metadata->>'persona','unknown') AS persona,
         event_type,
         COALESCE(anonymous_id, user_id::text, session_id) AS visitor_key
  FROM public.conversion_events
  WHERE created_at > now() - interval '30 days' AND package_id IS NOT NULL
), uniq AS (
  SELECT package_id, persona, event_type, visitor_key FROM base GROUP BY 1,2,3,4
)
SELECT package_id, persona,
  COUNT(DISTINCT visitor_key) FILTER (WHERE event_type IN ('page_view','lead_magnet_view')) AS step_view,
  COUNT(DISTINCT visitor_key) FILTER (WHERE event_type IN ('quiz_started','quiz_start')) AS step_quiz_start,
  COUNT(DISTINCT visitor_key) FILTER (WHERE event_type IN ('quiz_completed','quiz_complete')) AS step_quiz_complete,
  COUNT(DISTINCT visitor_key) FILTER (WHERE event_type IN ('lead_capture_submitted','lead_capture')) AS step_lead_capture,
  COUNT(DISTINCT visitor_key) FILTER (WHERE event_type='pricing_view') AS step_pricing,
  COUNT(DISTINCT visitor_key) FILTER (WHERE event_type='add_to_cart') AS step_add_to_cart,
  COUNT(DISTINCT visitor_key) FILTER (WHERE event_type='checkout_start') AS step_checkout_start,
  COUNT(DISTINCT visitor_key) FILTER (WHERE event_type='checkout_complete') AS step_checkout_complete
FROM uniq GROUP BY 1,2;

REVOKE ALL ON public.v_funnel_dropoff_per_lead_magnet FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_funnel_dropoff_per_lead_magnet TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_funnel_dropoff_heatmap(p_days int DEFAULT 30)
RETURNS TABLE(
  package_id uuid, package_key text, persona text,
  step_view bigint, step_quiz_start bigint, step_quiz_complete bigint,
  step_lead_capture bigint, step_pricing bigint, step_add_to_cart bigint,
  step_checkout_start bigint, step_checkout_complete bigint,
  dropoff_view_to_quiz numeric, dropoff_quiz_to_lead numeric,
  dropoff_lead_to_pricing numeric, dropoff_pricing_to_cart numeric,
  dropoff_cart_to_checkout numeric, dropoff_checkout_to_complete numeric,
  overall_conversion numeric
)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT f.package_id, cp.package_key, f.persona,
    f.step_view, f.step_quiz_start, f.step_quiz_complete,
    f.step_lead_capture, f.step_pricing, f.step_add_to_cart,
    f.step_checkout_start, f.step_checkout_complete,
    CASE WHEN f.step_view>0 THEN ROUND(100.0*(f.step_view-f.step_quiz_start)/f.step_view,1) END,
    CASE WHEN f.step_quiz_start>0 THEN ROUND(100.0*(f.step_quiz_start-f.step_lead_capture)/f.step_quiz_start,1) END,
    CASE WHEN f.step_lead_capture>0 THEN ROUND(100.0*(f.step_lead_capture-f.step_pricing)/f.step_lead_capture,1) END,
    CASE WHEN f.step_pricing>0 THEN ROUND(100.0*(f.step_pricing-f.step_add_to_cart)/f.step_pricing,1) END,
    CASE WHEN f.step_add_to_cart>0 THEN ROUND(100.0*(f.step_add_to_cart-f.step_checkout_start)/f.step_add_to_cart,1) END,
    CASE WHEN f.step_checkout_start>0 THEN ROUND(100.0*(f.step_checkout_start-f.step_checkout_complete)/f.step_checkout_start,1) END,
    CASE WHEN f.step_view>0 THEN ROUND(100.0*f.step_checkout_complete/f.step_view,2) END
  FROM public.v_funnel_dropoff_per_lead_magnet f
  LEFT JOIN public.course_packages cp ON cp.id=f.package_id
  WHERE pg_has_role('service_role','MEMBER') OR public.has_role(auth.uid(),'admin'::app_role);
$$;

REVOKE ALL ON FUNCTION public.admin_get_funnel_dropoff_heatmap(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_funnel_dropoff_heatmap(int) TO authenticated, service_role;
