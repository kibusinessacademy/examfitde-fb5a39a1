-- Audit contract
INSERT INTO ops_audit_contract(action_type, required_keys, schema_version, owner_module) VALUES
  ('pillar_mapping_drift_detected', ARRAY['package_id','classification','strategy_tried']::text[], 1, 'seo_e3b'),
  ('pillar_mapping_repair_dispatched', ARRAY['pillar_id','strategy','dry_run']::text[], 1, 'seo_e3b'),
  ('pillar_mapping_repair_completed', ARRAY['pillar_id','package_id','product_slug','strategy']::text[], 1, 'seo_e3b'),
  ('pillar_mapping_repair_failed', ARRAY['pillar_id','reason']::text[], 1, 'seo_e3b'),
  ('pillar_mapping_repair_run_summary', ARRAY['dispatched','dry_run','wip_cap']::text[], 1, 'seo_e3b'),
  ('pillar_mapping_heal_foundation_e3b_created', ARRAY[]::text[], 1, 'seo_e3b')
ON CONFLICT (action_type) DO NOTHING;

-- Detector
CREATE OR REPLACE FUNCTION public.fn_detect_pillar_mapping_gaps()
RETURNS TABLE(
  pillar_id uuid, pillar_slug text, catalog_id uuid, catalog_slug text, catalog_title text,
  resolved_package_id uuid, mapping_source text, classification text,
  candidate_package_id uuid, candidate_strategy text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH base AS (
  SELECT csp.id AS pillar_id, csp.slug AS pillar_slug, csp.certification_catalog_id AS catalog_id,
         csp.product_slug_override, cc.slug AS catalog_slug, cc.title AS catalog_title,
         cc.linked_certification_id, v.package_id AS resolved_package_id, v.mapping_source
  FROM certification_seo_pages csp
  LEFT JOIN certification_catalog cc ON cc.id = csp.certification_catalog_id
  LEFT JOIN v_certification_seo_with_product v ON v.seo_page_id = csp.id
  WHERE csp.is_published = true
),
strat_a AS (
  SELECT b.pillar_id, array_agg(DISTINCT cp.id) AS cand_ids
  FROM base b
  JOIN course_packages cp ON cp.certification_id = b.linked_certification_id AND cp.status='published'
  WHERE b.resolved_package_id IS NULL AND b.linked_certification_id IS NOT NULL
  GROUP BY b.pillar_id
),
strat_b AS (
  SELECT b.pillar_id, array_agg(DISTINCT cp.id) AS cand_ids
  FROM base b
  JOIN certifications c ON c.slug = b.catalog_slug
  JOIN course_packages cp ON cp.certification_id = c.id AND cp.status='published'
  WHERE b.resolved_package_id IS NULL AND b.catalog_slug IS NOT NULL
  GROUP BY b.pillar_id
)
SELECT b.pillar_id, b.pillar_slug, b.catalog_id, b.catalog_slug, b.catalog_title,
  b.resolved_package_id, b.mapping_source,
  CASE
    WHEN b.resolved_package_id IS NOT NULL
      AND b.mapping_source IN ('meta_override','id_chain','catalog_slug','slug_base') THEN 'MAPPED_OK'
    WHEN b.catalog_id IS NULL THEN 'ORPHANED_PILLAR'
    WHEN COALESCE(array_length(sa.cand_ids,1),0) = 1 THEN 'NO_PILLAR_MAPPING'
    WHEN COALESCE(array_length(sb.cand_ids,1),0) = 1 THEN 'NO_PILLAR_MAPPING'
    WHEN COALESCE(array_length(sa.cand_ids,1),0) > 1
      OR COALESCE(array_length(sb.cand_ids,1),0) > 1 THEN 'MULTIPLE_CANDIDATES'
    ELSE 'NEEDS_MANUAL_REVIEW'
  END AS classification,
  COALESCE(
    CASE WHEN array_length(sa.cand_ids,1)=1 THEN sa.cand_ids[1] END,
    CASE WHEN array_length(sb.cand_ids,1)=1 THEN sb.cand_ids[1] END
  ) AS candidate_package_id,
  CASE
    WHEN array_length(sa.cand_ids,1)=1 THEN 'linked_certification_id'
    WHEN array_length(sb.cand_ids,1)=1 THEN 'catalog_slug_equals_certification_slug'
    ELSE NULL
  END AS candidate_strategy
FROM base b
LEFT JOIN strat_a sa ON sa.pillar_id=b.pillar_id
LEFT JOIN strat_b sb ON sb.pillar_id=b.pillar_id;
$$;

REVOKE ALL ON FUNCTION public.fn_detect_pillar_mapping_gaps() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_detect_pillar_mapping_gaps() TO service_role;

-- Dispatch RPC
CREATE OR REPLACE FUNCTION public.admin_dispatch_pillar_mapping_repair(
  p_limit integer DEFAULT 25,
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE(
  pillar_id uuid, pillar_slug text, classification text, strategy text,
  candidate_package_id uuid, product_slug text, action text, applied boolean, reason text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_wip_cap integer := LEAST(GREATEST(COALESCE(p_limit,25),1),100);
  v_dispatched integer := 0;
  v_dry boolean := COALESCE(p_dry_run,true);
  v_rec record;
  v_product_slug text;
BEGIN
  IF NOT public.has_role(v_caller,'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE='42501';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _tmp_pillar_dispatch (
    pillar_id uuid, pillar_slug text, classification text, strategy text,
    candidate_package_id uuid, product_slug text, action text, applied boolean, reason text
  ) ON COMMIT DROP;
  DELETE FROM _tmp_pillar_dispatch;

  FOR v_rec IN
    SELECT * FROM public.fn_detect_pillar_mapping_gaps()
    WHERE classification IN ('NO_PILLAR_MAPPING','PILLAR_MAPPING_DRIFT','ORPHANED_PILLAR','MULTIPLE_CANDIDATES','NEEDS_MANUAL_REVIEW')
    ORDER BY CASE classification
      WHEN 'NO_PILLAR_MAPPING' THEN 1 WHEN 'PILLAR_MAPPING_DRIFT' THEN 2
      WHEN 'MULTIPLE_CANDIDATES' THEN 3 WHEN 'ORPHANED_PILLAR' THEN 4 ELSE 5 END,
      pillar_slug
    LIMIT v_wip_cap
  LOOP
    v_dispatched := v_dispatched + 1;
    v_product_slug := NULL;

    PERFORM public.fn_emit_audit(
      'pillar_mapping_repair_dispatched','pillar', v_rec.pillar_id::text,'ok',
      jsonb_build_object('pillar_id',v_rec.pillar_id,'strategy',COALESCE(v_rec.candidate_strategy,'none'),
                         'dry_run',v_dry,'classification',v_rec.classification),
      'admin_dispatch_pillar_mapping_repair', NULL);

    IF v_rec.candidate_package_id IS NOT NULL THEN
      SELECT vp.canonical_slug INTO v_product_slug
      FROM v_product_page_published_ssot vp
      WHERE vp.package_id = v_rec.candidate_package_id LIMIT 1;

      IF v_product_slug IS NULL THEN
        INSERT INTO _tmp_pillar_dispatch VALUES (
          v_rec.pillar_id,v_rec.pillar_slug,v_rec.classification,v_rec.candidate_strategy,
          v_rec.candidate_package_id,NULL,'SKIPPED',false,'candidate_has_no_published_product');
        PERFORM public.fn_emit_audit(
          'pillar_mapping_repair_failed','pillar',v_rec.pillar_id::text,'skipped',
          jsonb_build_object('pillar_id',v_rec.pillar_id,'reason','candidate_has_no_published_product'),
          'admin_dispatch_pillar_mapping_repair', NULL);
        CONTINUE;
      END IF;

      IF v_dry THEN
        INSERT INTO _tmp_pillar_dispatch VALUES (
          v_rec.pillar_id,v_rec.pillar_slug,v_rec.classification,v_rec.candidate_strategy,
          v_rec.candidate_package_id,v_product_slug,'DRY_RUN_WOULD_SET_OVERRIDE',false,NULL);
      ELSE
        UPDATE certification_seo_pages
          SET product_slug_override = v_product_slug, updated_at = now()
        WHERE id = v_rec.pillar_id;
        INSERT INTO _tmp_pillar_dispatch VALUES (
          v_rec.pillar_id,v_rec.pillar_slug,v_rec.classification,v_rec.candidate_strategy,
          v_rec.candidate_package_id,v_product_slug,'APPLIED_OVERRIDE',true,NULL);
        PERFORM public.fn_emit_audit(
          'pillar_mapping_repair_completed','pillar',v_rec.pillar_id::text,'ok',
          jsonb_build_object('pillar_id',v_rec.pillar_id,'package_id',v_rec.candidate_package_id,
                             'product_slug',v_product_slug,'strategy',v_rec.candidate_strategy),
          'admin_dispatch_pillar_mapping_repair', NULL);
      END IF;
    ELSE
      INSERT INTO _tmp_pillar_dispatch VALUES (
        v_rec.pillar_id,v_rec.pillar_slug,v_rec.classification,NULL,NULL,NULL,'NEEDS_MANUAL',false,
        CASE v_rec.classification
          WHEN 'ORPHANED_PILLAR' THEN 'no_certification_catalog_link'
          WHEN 'MULTIPLE_CANDIDATES' THEN 'ambiguous_candidates_require_human_decision'
          ELSE 'no_deterministic_candidate_found' END);
      PERFORM public.fn_emit_audit(
        'pillar_mapping_drift_detected','pillar',v_rec.pillar_id::text,'needs_review',
        jsonb_build_object('package_id',v_rec.resolved_package_id,'classification',v_rec.classification,
                           'strategy_tried',COALESCE(v_rec.candidate_strategy,'none'),'pillar_id',v_rec.pillar_id),
        'admin_dispatch_pillar_mapping_repair', NULL);
    END IF;
  END LOOP;

  PERFORM public.fn_emit_audit(
    'pillar_mapping_repair_run_summary','system',NULL,'ok',
    jsonb_build_object('dispatched',v_dispatched,'dry_run',v_dry,'wip_cap',v_wip_cap,'caller',v_caller),
    'admin_dispatch_pillar_mapping_repair', NULL);

  RETURN QUERY SELECT * FROM _tmp_pillar_dispatch;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_dispatch_pillar_mapping_repair(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_dispatch_pillar_mapping_repair(integer, boolean) TO authenticated, service_role;

-- Foundation audit
SELECT public.fn_emit_audit(
  'pillar_mapping_heal_foundation_e3b_created','system',NULL,'ok',
  jsonb_build_object(
    'view_dependency','v_certification_seo_with_product',
    'strategies', jsonb_build_array('linked_certification_id','catalog_slug_equals_certification_slug'),
    'auto_heal_route','product_slug_override',
    'manual_review_classes', jsonb_build_array('MULTIPLE_CANDIDATES','ORPHANED_PILLAR','NEEDS_MANUAL_REVIEW')
  ),
  'e3b_migration', NULL);