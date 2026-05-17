-- A1 Intent → Cert-Pillar Bridge

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('intent_pillar_bridge_detected', ARRAY['eligible_pairs','distinct_pillars','correlation_id']::text[], 'seo.bridge.a1'),
  ('intent_pillar_bridge_applied',  ARRAY['source_url','target_url','link_type','correlation_id']::text[], 'seo.bridge.a1'),
  ('intent_pillar_bridge_skipped',  ARRAY['reason','source_url','target_url','link_type','correlation_id']::text[], 'seo.bridge.a1'),
  ('intent_pillar_bridge_summary',  ARRAY['inserted','skipped_existing','dry_run','correlation_id']::text[], 'seo.bridge.a1')
ON CONFLICT (action_type) DO NOTHING;

CREATE OR REPLACE VIEW public.v_intent_to_cert_pillar_bridge_candidates AS
WITH cert_route AS (
  SELECT
    csp.id    AS cert_pillar_id,
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
)
SELECT
  sp.id                                           AS intent_page_id,
  sp.slug                                         AS intent_slug,
  sp.title                                        AS intent_title,
  sp.curriculum_id,
  cr.cert_pillar_id,
  cr.cert_slug,
  cr.cert_title,
  cr.route_prefix,
  ('/kurse/' || sp.slug)                          AS source_url,
  ('/' || cr.route_prefix || '/' || cr.cert_slug) AS target_url,
  CASE
    WHEN cr.route_prefix IS NULL THEN 'UNROUTED_CATALOG_TYPE'
    WHEN EXISTS (
      SELECT 1 FROM public.seo_internal_link_suggestions s
      WHERE s.source_url = ('/kurse/' || sp.slug)
        AND s.target_url = ('/' || cr.route_prefix || '/' || cr.cert_slug)
        AND s.link_type  = 'cluster_to_pillar'
    ) AND EXISTS (
      SELECT 1 FROM public.seo_internal_link_suggestions s
      WHERE s.source_url = ('/' || cr.route_prefix || '/' || cr.cert_slug)
        AND s.target_url = ('/kurse/' || sp.slug)
        AND s.link_type  = 'pillar_to_cluster'
    ) THEN 'ALREADY_LINKED'
    ELSE 'READY_TO_BRIDGE'
  END AS decision
FROM public.seo_content_pages sp
JOIN public.curricula      cu ON cu.id = sp.curriculum_id
JOIN public.certifications ce ON ce.id = cu.certification_id
JOIN cert_route            cr ON cr.cert_slug = ce.slug
WHERE sp.status = 'published'
  AND sp.quality_score >= 80
  AND sp.page_type = 'intent_page';

REVOKE ALL ON public.v_intent_to_cert_pillar_bridge_candidates FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_intent_to_cert_pillar_bridge_candidates TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_intent_pillar_bridge_summary()
RETURNS TABLE (decision text, pair_count integer, distinct_pillars integer, distinct_intents integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.decision,
         COUNT(*)::int,
         COUNT(DISTINCT v.cert_pillar_id)::int,
         COUNT(DISTINCT v.intent_page_id)::int
  FROM public.v_intent_to_cert_pillar_bridge_candidates v
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
  GROUP BY v.decision
  ORDER BY v.decision;
$$;
REVOKE ALL ON FUNCTION public.admin_get_intent_pillar_bridge_summary() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_get_intent_pillar_bridge_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_seo_bridge_intent_to_cert_pillar(
  p_limit integer DEFAULT 25, p_dry_run boolean DEFAULT true, p_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_correlation uuid := gen_random_uuid();
  v_cap int := LEAST(GREATEST(COALESCE(p_limit,25),1),100);
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

  SELECT COALESCE(SUM(CASE WHEN decision='READY_TO_BRIDGE' THEN 1 ELSE 0 END),0)::int,
         COALESCE(COUNT(DISTINCT CASE WHEN decision='READY_TO_BRIDGE' THEN cert_pillar_id END),0)::int
    INTO v_eligible, v_pillars
  FROM public.v_intent_to_cert_pillar_bridge_candidates;

  PERFORM public.fn_emit_audit('intent_pillar_bridge_detected', jsonb_build_object(
    'eligible_pairs',v_eligible,'distinct_pillars',v_pillars,
    'correlation_id',v_correlation,'cap',v_cap,'dry_run',p_dry_run));

  FOR rec IN
    SELECT * FROM public.v_intent_to_cert_pillar_bridge_candidates
    WHERE decision='READY_TO_BRIDGE'
    ORDER BY cert_pillar_id, intent_page_id
    LIMIT v_cap
  LOOP
    IF p_dry_run THEN
      v_skipped := v_skipped + 2;
      PERFORM public.fn_emit_audit('intent_pillar_bridge_skipped', jsonb_build_object(
        'reason','dry_run','source_url',rec.source_url,'target_url',rec.target_url,
        'link_type','cluster_to_pillar','correlation_id',v_correlation));
      PERFORM public.fn_emit_audit('intent_pillar_bridge_skipped', jsonb_build_object(
        'reason','dry_run','source_url',rec.target_url,'target_url',rec.source_url,
        'link_type','pillar_to_cluster','correlation_id',v_correlation));
      CONTINUE;
    END IF;

    WITH ins AS (
      INSERT INTO public.seo_internal_link_suggestions
        (source_url,target_url,link_type,anchor_text,status,relevance_score,priority,reason)
      VALUES (rec.source_url,rec.target_url,'cluster_to_pillar',
              COALESCE(rec.cert_title,rec.cert_slug),'suggested',90,1,'A1 intent→cert_pillar bridge')
      ON CONFLICT (source_url,target_url,link_type) DO NOTHING
      RETURNING 1
    ) SELECT EXISTS(SELECT 1 FROM ins) INTO v_did;
    IF v_did THEN
      v_inserted := v_inserted + 1;
      PERFORM public.fn_emit_audit('intent_pillar_bridge_applied', jsonb_build_object(
        'source_url',rec.source_url,'target_url',rec.target_url,
        'link_type','cluster_to_pillar','correlation_id',v_correlation,
        'intent_page_id',rec.intent_page_id,'cert_pillar_id',rec.cert_pillar_id));
    ELSE
      v_skipped := v_skipped + 1;
      PERFORM public.fn_emit_audit('intent_pillar_bridge_skipped', jsonb_build_object(
        'reason','already_exists','source_url',rec.source_url,'target_url',rec.target_url,
        'link_type','cluster_to_pillar','correlation_id',v_correlation));
    END IF;

    WITH ins AS (
      INSERT INTO public.seo_internal_link_suggestions
        (source_url,target_url,link_type,anchor_text,status,relevance_score,priority,reason)
      VALUES (rec.target_url,rec.source_url,'pillar_to_cluster',
              COALESCE(rec.intent_title,rec.intent_slug),'suggested',85,2,'A1 cert_pillar→intent backlink')
      ON CONFLICT (source_url,target_url,link_type) DO NOTHING
      RETURNING 1
    ) SELECT EXISTS(SELECT 1 FROM ins) INTO v_did;
    IF v_did THEN
      v_inserted := v_inserted + 1;
      PERFORM public.fn_emit_audit('intent_pillar_bridge_applied', jsonb_build_object(
        'source_url',rec.target_url,'target_url',rec.source_url,
        'link_type','pillar_to_cluster','correlation_id',v_correlation,
        'intent_page_id',rec.intent_page_id,'cert_pillar_id',rec.cert_pillar_id));
    ELSE
      v_skipped := v_skipped + 1;
      PERFORM public.fn_emit_audit('intent_pillar_bridge_skipped', jsonb_build_object(
        'reason','already_exists','source_url',rec.target_url,'target_url',rec.source_url,
        'link_type','pillar_to_cluster','correlation_id',v_correlation));
    END IF;
  END LOOP;

  PERFORM public.fn_emit_audit('intent_pillar_bridge_summary', jsonb_build_object(
    'inserted',v_inserted,'skipped_existing',v_skipped,'dry_run',p_dry_run,
    'eligible_pairs',v_eligible,'distinct_pillars',v_pillars,
    'correlation_id',v_correlation,'reason',p_reason));

  RETURN jsonb_build_object(
    'ok',true,'correlation_id',v_correlation,'dry_run',p_dry_run,'cap',v_cap,
    'eligible_pairs',v_eligible,'distinct_pillars',v_pillars,
    'inserted',v_inserted,'skipped',v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_seo_bridge_intent_to_cert_pillar(integer,boolean,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_seo_bridge_intent_to_cert_pillar(integer,boolean,text) TO authenticated;