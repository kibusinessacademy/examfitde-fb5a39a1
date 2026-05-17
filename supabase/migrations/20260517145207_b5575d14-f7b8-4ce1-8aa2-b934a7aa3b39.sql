
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('pillar_backfill_pillar_created',
    ARRAY['package_id','catalog_id','pillar_id','pillar_slug','dry_run','reason'],
    'seo/e3f'),
  ('pillar_backfill_pillar_skipped',
    ARRAY['package_id','catalog_id','skip_reason','dry_run'],
    'seo/e3f'),
  ('pillar_backfill_summary',
    ARRAY['ran_at','dry_run','reason','limit','attempted','created','skipped','failed'],
    'seo/e3f')
ON CONFLICT (action_type) DO NOTHING;

CREATE OR REPLACE VIEW public.v_pillar_generation_backfill_candidates AS
WITH pkg AS (
  SELECT cp.id AS package_id, cp.certification_id, cp.curriculum_id,
         cp.title AS package_title, cp.status AS package_status, cp.product_id
  FROM course_packages cp
),
prod AS (
  SELECT p.id AS product_id, p.slug AS product_slug, p.status AS product_status,
         p.visibility, p.certification_id
  FROM products p
),
pkg_prod AS (
  SELECT pk.package_id, pk.certification_id, pk.curriculum_id,
         pk.package_title, pk.package_status,
         COALESCE(pk.product_id, pr2.product_id) AS product_id,
         COALESCE(pr1.product_status, pr2.product_status) AS product_status,
         COALESCE(pr1.visibility,    pr2.visibility)    AS product_visibility,
         COALESCE(pr1.product_slug,  pr2.product_slug)  AS product_slug
  FROM pkg pk
    LEFT JOIN prod pr1 ON pr1.product_id = pk.product_id
    LEFT JOIN prod pr2 ON pr2.certification_id = pk.certification_id
                       AND pr2.product_status = 'active'
                       AND pk.product_id IS NULL
),
cat_match AS (
  SELECT pp.package_id,
         (SELECT COUNT(*) FROM certification_catalog cc
           WHERE cc.linked_certification_id = pp.certification_id) AS catalog_match_count,
         (SELECT cc.id FROM certification_catalog cc
           WHERE cc.linked_certification_id = pp.certification_id
           ORDER BY cc.priority_score DESC NULLS LAST, cc.created_at ASC
           LIMIT 1) AS catalog_id
  FROM pkg_prod pp
),
existing_pillar AS (
  SELECT certification_catalog_id,
         (array_agg(id ORDER BY created_at ASC))[1] AS pillar_id
  FROM certification_seo_pages
  WHERE page_type = 'landing' AND certification_catalog_id IS NOT NULL
  GROUP BY certification_catalog_id
)
SELECT
  pp.package_id,
  pp.package_title,
  pp.package_status,
  pp.certification_id,
  pp.product_id,
  pp.product_slug,
  pp.product_status,
  pp.product_visibility,
  cm.catalog_match_count,
  cm.catalog_id,
  cc.slug  AS catalog_slug,
  cc.title AS catalog_title,
  ep.pillar_id AS existing_pillar_id,
  CASE
    WHEN pp.package_status <> 'published'                     THEN 'PACKAGE_NOT_PUBLISHED'
    WHEN cm.catalog_match_count = 0                           THEN 'NO_CATALOG_MAPPING'
    WHEN cm.catalog_match_count > 1                           THEN 'AMBIGUOUS_MAPPING'
    WHEN ep.pillar_id IS NOT NULL                             THEN 'PILLAR_ALREADY_EXISTS'
    WHEN pp.product_id IS NULL
      OR COALESCE(pp.product_status,'') <> 'active'           THEN 'SKIP_NOT_SELLABLE'
    WHEN COALESCE(pp.product_visibility,'') <> 'public'       THEN 'PRODUCT_NOT_PUBLIC'
    ELSE 'READY_TO_GENERATE'
  END AS decision
FROM pkg_prod pp
LEFT JOIN cat_match cm     ON cm.package_id = pp.package_id
LEFT JOIN certification_catalog cc ON cc.id = cm.catalog_id
LEFT JOIN existing_pillar ep ON ep.certification_catalog_id = cm.catalog_id;

REVOKE ALL ON public.v_pillar_generation_backfill_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_pillar_generation_backfill_candidates TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_pillar_backfill_candidates(
  p_decision text DEFAULT NULL,
  p_limit    int  DEFAULT 200
)
RETURNS TABLE (
  package_id uuid, package_title text, decision text,
  catalog_id uuid, catalog_slug text, catalog_title text,
  existing_pillar_id uuid, product_slug text,
  product_status text, product_visibility text,
  catalog_match_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN QUERY
  SELECT v.package_id, v.package_title, v.decision,
         v.catalog_id, v.catalog_slug, v.catalog_title,
         v.existing_pillar_id, v.product_slug,
         v.product_status, v.product_visibility,
         v.catalog_match_count
  FROM public.v_pillar_generation_backfill_candidates v
  WHERE (p_decision IS NULL OR v.decision = p_decision)
  ORDER BY
    CASE v.decision WHEN 'READY_TO_GENERATE' THEN 0 ELSE 1 END,
    v.catalog_title NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(p_limit,200),1), 1000);
END $$;

REVOKE ALL ON FUNCTION public.admin_get_pillar_backfill_candidates(text,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_pillar_backfill_candidates(text,int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_backfill_certification_pillars(
  p_limit   int     DEFAULT 25,
  p_dry_run boolean DEFAULT true,
  p_reason  text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cap       int := LEAST(GREATEST(COALESCE(p_limit,25),1), 100);
  v_attempted int := 0;
  v_created   int := 0;
  v_skipped   int := 0;
  v_failed    int := 0;
  v_rec       record;
  v_slug      text;
  v_title     text;
  v_meta_t    text;
  v_meta_d    text;
  v_intro     text;
  v_pillar_id uuid;
  v_results   jsonb := '[]'::jsonb;
  v_started   timestamptz := now();
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF NOT p_dry_run AND (p_reason IS NULL OR length(trim(p_reason)) < 10) THEN
    RAISE EXCEPTION 'live backfill requires p_reason of >=10 chars';
  END IF;

  FOR v_rec IN
    SELECT * FROM public.v_pillar_generation_backfill_candidates
    WHERE decision = 'READY_TO_GENERATE'
    ORDER BY catalog_title NULLS LAST
    LIMIT v_cap
  LOOP
    v_attempted := v_attempted + 1;
    BEGIN
      v_slug   := v_rec.catalog_slug || '-pruefung';
      v_title  := v_rec.catalog_title || ' Prüfungstrainer 2026 – 1.100+ Fragen';
      v_meta_t := v_title || ' | ExamFit';
      v_meta_d := 'Bestehe die ' || v_rec.catalog_title
                  || '-Prüfung sicher mit 1.100+ originalgetreuen Prüfungsfragen, KI-Simulation & mündlicher Vorbereitung. 100% Rahmenplan-Coverage.';
      v_intro  := 'Vorbereitung auf die ' || v_rec.catalog_title || '-Prüfung mit ExamFit.';

      IF EXISTS (
        SELECT 1 FROM certification_seo_pages
        WHERE page_type='landing' AND certification_catalog_id = v_rec.catalog_id
      ) THEN
        v_skipped := v_skipped + 1;
        PERFORM public.fn_emit_audit(
          'pillar_backfill_pillar_skipped','course_package', v_rec.package_id::text,'skipped',
          jsonb_build_object(
            'package_id', v_rec.package_id, 'catalog_id', v_rec.catalog_id,
            'skip_reason','PILLAR_ALREADY_EXISTS','dry_run', p_dry_run
          ),'admin_backfill_certification_pillars');
        v_results := v_results || jsonb_build_object(
          'package_id', v_rec.package_id, 'status','skipped',
          'reason','PILLAR_ALREADY_EXISTS');
        CONTINUE;
      END IF;

      IF p_dry_run THEN
        v_pillar_id := NULL;
        v_created := v_created + 1;
      ELSE
        INSERT INTO certification_seo_pages (
          certification_catalog_id, page_type, slug, title,
          meta_title, meta_description, content_json,
          is_published, word_count, internal_links
        ) VALUES (
          v_rec.catalog_id, 'landing', v_slug, v_title,
          v_meta_t, v_meta_d,
          jsonb_build_object(
            'hero_headline', v_title,
            'intro', v_intro,
            'target_persona','exam_candidate',
            'linked_package_id', v_rec.package_id,
            'linked_certification_id', v_rec.certification_id,
            'generated_by','admin_backfill_certification_pillars',
            'generated_at', now()
          ),
          false, 0, '[]'::jsonb
        ) RETURNING id INTO v_pillar_id;
        v_created := v_created + 1;
      END IF;

      PERFORM public.fn_emit_audit(
        'pillar_backfill_pillar_created','certification_seo_pages',
        COALESCE(v_pillar_id::text, v_rec.catalog_id::text),'success',
        jsonb_build_object(
          'package_id', v_rec.package_id,
          'catalog_id', v_rec.catalog_id,
          'pillar_id',  v_pillar_id,
          'pillar_slug', v_slug,
          'dry_run', p_dry_run,
          'reason', COALESCE(p_reason,'(dry_run)')
        ),'admin_backfill_certification_pillars');

      v_results := v_results || jsonb_build_object(
        'package_id', v_rec.package_id, 'status', CASE WHEN p_dry_run THEN 'dry_run' ELSE 'created' END,
        'pillar_id', v_pillar_id, 'pillar_slug', v_slug);

    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_object(
        'package_id', v_rec.package_id, 'status','failed',
        'error', SQLERRM);
      BEGIN
        PERFORM public.fn_emit_audit(
          'pillar_backfill_pillar_skipped','course_package', v_rec.package_id::text,'error',
          jsonb_build_object(
            'package_id', v_rec.package_id, 'catalog_id', v_rec.catalog_id,
            'skip_reason','EXCEPTION','dry_run', p_dry_run,
            'error', SQLERRM),
          'admin_backfill_certification_pillars', SQLERRM);
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END;
  END LOOP;

  PERFORM public.fn_emit_audit(
    'pillar_backfill_summary','system', NULL,
    CASE WHEN v_failed=0 THEN 'success' ELSE 'partial' END,
    jsonb_build_object(
      'ran_at', v_started, 'dry_run', p_dry_run,
      'reason', COALESCE(p_reason,'(dry_run)'),
      'limit', v_cap, 'attempted', v_attempted,
      'created', v_created, 'skipped', v_skipped, 'failed', v_failed,
      'results', v_results),
    'admin_backfill_certification_pillars');

  RETURN jsonb_build_object(
    'ok', true, 'dry_run', p_dry_run,
    'attempted', v_attempted, 'created', v_created,
    'skipped', v_skipped, 'failed', v_failed,
    'results', v_results);
END $$;

REVOKE ALL ON FUNCTION public.admin_backfill_certification_pillars(int,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_backfill_certification_pillars(int,boolean,text) TO authenticated, service_role;
