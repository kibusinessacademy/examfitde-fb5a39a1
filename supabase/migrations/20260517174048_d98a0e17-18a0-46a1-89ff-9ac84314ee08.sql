
-- A2 Persona-Landing → Cert-Pillar Bridge

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('persona_cert_pillar_link_detected', ARRAY['eligible_pairs','distinct_pillars','correlation_id']::text[], 'seo.bridge.a2'),
  ('persona_cert_pillar_link_suggested', ARRAY['source_url','target_url','link_type','correlation_id']::text[], 'seo.bridge.a2'),
  ('persona_cert_pillar_link_skipped', ARRAY['reason','source_url','target_url','link_type','correlation_id']::text[], 'seo.bridge.a2'),
  ('persona_cert_pillar_link_summary', ARRAY['inserted','skipped_existing','dry_run','correlation_id']::text[], 'seo.bridge.a2')
ON CONFLICT (action_type) DO NOTHING;

CREATE OR REPLACE VIEW public.v_persona_landing_cert_pillar_link_candidates AS
WITH cert_route AS (
  SELECT
    csp.id    AS cert_pillar_id,
    cc.id     AS catalog_id,
    cc.linked_certification_id AS cert_id,
    cc.slug   AS cert_slug,
    csp.title AS cert_title,
    CASE cc.catalog_type::text
      WHEN 'Ausbildung'         THEN 'ausbildung'
      WHEN 'Fortbildung_IHK'    THEN 'fachwirt'
      WHEN 'Fortbildung_HWK'    THEN 'fachwirt'
      WHEN 'Meister'            THEN 'meister'
      WHEN 'Sachkunde'          THEN 'sachkunde'
      WHEN 'Branchenzertifikat' THEN 'sachkunde'
      WHEN 'Projektmanagement'  THEN 'projektmanagement'
      ELSE NULL
    END AS route_prefix
  FROM public.certification_seo_pages csp
  JOIN public.certification_catalog cc ON cc.id = csp.certification_catalog_id
  WHERE csp.is_published = true
),
src AS (
  SELECT
    sp.id           AS persona_page_id,
    sp.slug         AS persona_slug,
    sp.title        AS persona_title,
    sp.persona_type,
    sp.package_id,
    cp.certification_id,
    ('/' || sp.slug) AS source_url
  FROM public.seo_content_pages sp
  LEFT JOIN public.course_packages cp ON cp.id = sp.package_id
  WHERE sp.page_type = 'persona_landing'
    AND sp.status = 'published'
),
joined AS (
  SELECT
    src.*,
    cr.cert_pillar_id,
    cr.cert_slug,
    cr.cert_title,
    cr.route_prefix,
    CASE WHEN cr.route_prefix IS NOT NULL AND cr.cert_slug IS NOT NULL
         THEN ('/' || cr.route_prefix || '/' || cr.cert_slug)
         ELSE NULL END AS target_url,
    COUNT(cr.cert_pillar_id) OVER (PARTITION BY src.persona_page_id) AS pillar_match_count
  FROM src
  LEFT JOIN cert_route cr ON cr.cert_id = src.certification_id
)
SELECT
  persona_page_id,
  persona_slug,
  persona_title,
  persona_type,
  package_id,
  certification_id,
  cert_pillar_id,
  cert_slug,
  cert_title,
  route_prefix,
  source_url,
  target_url,
  CASE
    WHEN persona_type NOT IN ('azubi','betrieb','institution')
      THEN 'INVALID_PERSONA_ROUTE'
    WHEN cert_pillar_id IS NULL
      THEN 'NO_CERT_MAPPING'
    WHEN route_prefix IS NULL
      THEN 'UNROUTED_CATALOG_TYPE'
    WHEN pillar_match_count > 1
      THEN 'AMBIGUOUS_ROUTE'
    WHEN EXISTS (
      SELECT 1 FROM public.seo_internal_link_suggestions s
      WHERE s.source_url = source_url
        AND s.target_url = target_url
        AND s.link_type  = 'cluster_to_pillar'
        AND s.status     = 'active'
    ) AND EXISTS (
      SELECT 1 FROM public.seo_internal_link_suggestions s
      WHERE s.source_url = target_url
        AND s.target_url = source_url
        AND s.link_type  = 'pillar_to_cluster'
        AND s.status     = 'active'
    )
      THEN 'ALREADY_ACTIVE'
    WHEN EXISTS (
      SELECT 1 FROM public.seo_internal_link_suggestions s
      WHERE s.source_url = source_url
        AND s.target_url = target_url
        AND s.link_type  = 'cluster_to_pillar'
    ) AND EXISTS (
      SELECT 1 FROM public.seo_internal_link_suggestions s
      WHERE s.source_url = target_url
        AND s.target_url = source_url
        AND s.link_type  = 'pillar_to_cluster'
    )
      THEN 'ALREADY_SUGGESTED'
    ELSE 'READY_TO_SUGGEST'
  END AS decision
FROM joined;

REVOKE ALL ON public.v_persona_landing_cert_pillar_link_candidates FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_persona_landing_cert_pillar_link_candidates TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_persona_pillar_bridge_summary()
RETURNS TABLE (decision text, pair_count integer, distinct_pillars integer, distinct_sources integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.decision,
         COUNT(*)::int,
         COUNT(DISTINCT v.cert_pillar_id)::int,
         COUNT(DISTINCT v.persona_page_id)::int
  FROM public.v_persona_landing_cert_pillar_link_candidates v
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
  GROUP BY v.decision
  ORDER BY v.decision;
$$;
REVOKE ALL ON FUNCTION public.admin_get_persona_pillar_bridge_summary() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_get_persona_pillar_bridge_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_suggest_persona_landing_cert_pillar_links(
  p_limit integer DEFAULT 100,
  p_dry_run boolean DEFAULT true,
  p_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_correlation uuid := gen_random_uuid();
  v_cap int := LEAST(GREATEST(COALESCE(p_limit,100),1),100);
  v_inserted int := 0;
  v_skipped int := 0;
  v_eligible int;
  v_pillars int;
  rec record;
  v_did boolean;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF p_dry_run = false AND (p_reason IS NULL OR length(btrim(p_reason)) < 5) THEN
    RAISE EXCEPTION 'reason required (min 5 chars) for live apply';
  END IF;

  SELECT COALESCE(SUM(CASE WHEN decision='READY_TO_SUGGEST' THEN 1 ELSE 0 END),0)::int,
         COALESCE(COUNT(DISTINCT CASE WHEN decision='READY_TO_SUGGEST' THEN cert_pillar_id END),0)::int
    INTO v_eligible, v_pillars
  FROM public.v_persona_landing_cert_pillar_link_candidates;

  PERFORM public.fn_emit_audit('persona_cert_pillar_link_detected', jsonb_build_object(
    'eligible_pairs',v_eligible,'distinct_pillars',v_pillars,
    'correlation_id',v_correlation,'cap',v_cap,'dry_run',p_dry_run));

  FOR rec IN
    SELECT * FROM public.v_persona_landing_cert_pillar_link_candidates
    WHERE decision='READY_TO_SUGGEST'
    ORDER BY cert_pillar_id, persona_page_id
    LIMIT v_cap
  LOOP
    IF p_dry_run THEN
      v_skipped := v_skipped + 2;
      PERFORM public.fn_emit_audit('persona_cert_pillar_link_skipped', jsonb_build_object(
        'reason','dry_run','source_url',rec.source_url,'target_url',rec.target_url,
        'link_type','cluster_to_pillar','correlation_id',v_correlation));
      PERFORM public.fn_emit_audit('persona_cert_pillar_link_skipped', jsonb_build_object(
        'reason','dry_run','source_url',rec.target_url,'target_url',rec.source_url,
        'link_type','pillar_to_cluster','correlation_id',v_correlation));
      CONTINUE;
    END IF;

    WITH ins AS (
      INSERT INTO public.seo_internal_link_suggestions
        (source_url,target_url,link_type,anchor_text,status,relevance_score,priority,reason)
      VALUES (rec.source_url,rec.target_url,'cluster_to_pillar',
              COALESCE(rec.cert_title,rec.cert_slug),'suggested',88,1,
              'A2 persona_landing→cert_pillar bridge ('||rec.persona_type||')')
      ON CONFLICT (source_url,target_url,link_type) DO NOTHING
      RETURNING 1
    ) SELECT EXISTS(SELECT 1 FROM ins) INTO v_did;
    IF v_did THEN
      v_inserted := v_inserted + 1;
      PERFORM public.fn_emit_audit('persona_cert_pillar_link_suggested', jsonb_build_object(
        'source_url',rec.source_url,'target_url',rec.target_url,
        'link_type','cluster_to_pillar','correlation_id',v_correlation,
        'persona_page_id',rec.persona_page_id,'cert_pillar_id',rec.cert_pillar_id,
        'persona_type',rec.persona_type));
    ELSE
      v_skipped := v_skipped + 1;
      PERFORM public.fn_emit_audit('persona_cert_pillar_link_skipped', jsonb_build_object(
        'reason','already_exists','source_url',rec.source_url,'target_url',rec.target_url,
        'link_type','cluster_to_pillar','correlation_id',v_correlation));
    END IF;

    WITH ins AS (
      INSERT INTO public.seo_internal_link_suggestions
        (source_url,target_url,link_type,anchor_text,status,relevance_score,priority,reason)
      VALUES (rec.target_url,rec.source_url,'pillar_to_cluster',
              COALESCE(rec.persona_title,rec.persona_slug),'suggested',83,2,
              'A2 cert_pillar→persona_landing backlink ('||rec.persona_type||')')
      ON CONFLICT (source_url,target_url,link_type) DO NOTHING
      RETURNING 1
    ) SELECT EXISTS(SELECT 1 FROM ins) INTO v_did;
    IF v_did THEN
      v_inserted := v_inserted + 1;
      PERFORM public.fn_emit_audit('persona_cert_pillar_link_suggested', jsonb_build_object(
        'source_url',rec.target_url,'target_url',rec.source_url,
        'link_type','pillar_to_cluster','correlation_id',v_correlation,
        'persona_page_id',rec.persona_page_id,'cert_pillar_id',rec.cert_pillar_id,
        'persona_type',rec.persona_type));
    ELSE
      v_skipped := v_skipped + 1;
      PERFORM public.fn_emit_audit('persona_cert_pillar_link_skipped', jsonb_build_object(
        'reason','already_exists','source_url',rec.target_url,'target_url',rec.source_url,
        'link_type','pillar_to_cluster','correlation_id',v_correlation));
    END IF;
  END LOOP;

  PERFORM public.fn_emit_audit('persona_cert_pillar_link_summary', jsonb_build_object(
    'inserted',v_inserted,'skipped_existing',v_skipped,'dry_run',p_dry_run,
    'eligible_pairs',v_eligible,'distinct_pillars',v_pillars,
    'correlation_id',v_correlation,'reason',p_reason));

  RETURN jsonb_build_object(
    'ok',true,'correlation_id',v_correlation,'dry_run',p_dry_run,'cap',v_cap,
    'eligible_pairs',v_eligible,'distinct_pillars',v_pillars,
    'inserted',v_inserted,'skipped',v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_suggest_persona_landing_cert_pillar_links(integer,boolean,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_suggest_persona_landing_cert_pillar_links(integer,boolean,text) TO authenticated;
