-- E3f Publish-Gate v1: SSOT readiness view + admin RPC + 3 audit contracts.

-- 1) Audit contracts
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module) VALUES
  ('pillar_publish_attempt',
    ARRAY['pillar_id','catalog_id','package_id','dry_run','reason'],
    'seo/e3f-publish'),
  ('pillar_publish_skipped',
    ARRAY['pillar_id','catalog_id','skip_reason','dry_run'],
    'seo/e3f-publish'),
  ('pillar_publish_summary',
    ARRAY['ran_at','dry_run','reason','limit','attempted','published','skipped','failed'],
    'seo/e3f-publish')
ON CONFLICT (action_type) DO NOTHING;

-- 2) SSOT readiness view
CREATE OR REPLACE VIEW public.v_pillar_publish_readiness AS
WITH cat_pkg AS (
  SELECT cc.id AS catalog_id,
         cc.slug AS catalog_slug,
         cc.linked_certification_id,
         cp.id AS package_id,
         cp.title AS package_title,
         cp.status AS package_status,
         cp.product_id AS pkg_product_id,
         p.id AS product_id,
         p.slug AS product_slug,
         p.status AS product_status,
         p.visibility AS product_visibility
  FROM public.certification_catalog cc
  LEFT JOIN public.course_packages cp
         ON cp.certification_id = cc.linked_certification_id
        AND cp.status = 'published'
  LEFT JOIN public.products p
         ON p.id = cp.product_id
),
pil AS (
  SELECT csp.id AS pillar_id,
         csp.certification_catalog_id,
         csp.slug,
         csp.title,
         csp.meta_title,
         csp.meta_description,
         csp.is_published,
         csp.quality_score,
         csp.word_count,
         csp.internal_links,
         csp.content_json,
         (csp.content_json->>'linked_package_id')      AS cj_pkg_id,
         (csp.content_json->>'linked_certification_id') AS cj_cert_id
  FROM public.certification_seo_pages csp
  WHERE csp.page_type = 'landing'
),
slug_dup AS (
  SELECT slug, COUNT(*) AS n
  FROM public.certification_seo_pages
  WHERE page_type='landing'
  GROUP BY slug
)
SELECT
  pi.pillar_id,
  pi.slug,
  cp.catalog_id,
  cp.catalog_slug,
  cp.package_id,
  cp.package_title,
  cp.product_id,
  cp.product_slug,
  cp.product_status,
  cp.product_visibility,
  pi.is_published,
  COALESCE(pi.quality_score, 0) AS quality_score,
  COALESCE(pi.word_count, 0)    AS word_count,
  jsonb_array_length(COALESCE(pi.internal_links, '[]'::jsonb)) AS outbound_links,
  length(COALESCE(pi.meta_description,'')) AS meta_desc_len,
  length(COALESCE(pi.meta_title,'')) AS meta_title_len,
  (pi.cj_pkg_id IS NOT NULL)  AS has_package_link,
  (pi.cj_cert_id IS NOT NULL) AS has_cert_link,
  COALESCE(sd.n, 0) AS slug_dup_count,
  CASE
    WHEN pi.is_published IS TRUE                               THEN 'ALREADY_PUBLISHED'
    WHEN cp.package_id IS NULL                                 THEN 'NO_PUBLISHED_PACKAGE'
    WHEN cp.product_id IS NULL
      OR COALESCE(cp.product_status,'') <> 'active'            THEN 'PRODUCT_NOT_ACTIVE'
    WHEN COALESCE(cp.product_visibility,'') <> 'public'        THEN 'PRODUCT_NOT_PUBLIC'
    WHEN pi.cj_pkg_id IS NULL                                  THEN 'MISSING_PACKAGE_LINK'
    WHEN pi.cj_cert_id IS NULL                                 THEN 'MISSING_CERT_LINK'
    WHEN pi.slug IS NULL OR length(pi.slug) < 3                THEN 'INVALID_SLUG'
    WHEN COALESCE(sd.n,1) > 1                                  THEN 'SLUG_NOT_UNIQUE'
    WHEN COALESCE(length(pi.meta_title),0) < 10                THEN 'MISSING_META_TITLE'
    WHEN COALESCE(length(pi.meta_description),0) < 80          THEN 'META_DESC_TOO_SHORT'
    WHEN COALESCE(pi.quality_score,0) < 70                     THEN 'QUALITY_TOO_LOW'
    ELSE 'READY_TO_PUBLISH'
  END AS decision
FROM pil pi
LEFT JOIN cat_pkg cp ON cp.catalog_id = pi.certification_catalog_id
LEFT JOIN slug_dup sd ON sd.slug = pi.slug;

REVOKE ALL ON public.v_pillar_publish_readiness FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_pillar_publish_readiness TO service_role;

-- 3) Admin read RPC
CREATE OR REPLACE FUNCTION public.admin_get_pillar_publish_readiness(
  p_decision text DEFAULT NULL,
  p_limit    int  DEFAULT 200
)
RETURNS TABLE (
  pillar_id uuid, slug text, decision text,
  catalog_id uuid, catalog_slug text,
  package_id uuid, package_title text,
  product_slug text, product_status text, product_visibility text,
  quality_score numeric, word_count int,
  outbound_links int, meta_desc_len int, meta_title_len int,
  has_package_link boolean, has_cert_link boolean,
  slug_dup_count bigint, is_published boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  RETURN QUERY
  SELECT v.pillar_id, v.slug, v.decision,
         v.catalog_id, v.catalog_slug,
         v.package_id, v.package_title,
         v.product_slug, v.product_status, v.product_visibility,
         v.quality_score, v.word_count,
         v.outbound_links, v.meta_desc_len, v.meta_title_len,
         v.has_package_link, v.has_cert_link,
         v.slug_dup_count, v.is_published
  FROM public.v_pillar_publish_readiness v
  WHERE (p_decision IS NULL OR v.decision = p_decision)
  ORDER BY CASE v.decision WHEN 'READY_TO_PUBLISH' THEN 0 ELSE 1 END,
           v.catalog_slug NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(p_limit,200),1), 1000);
END $$;

REVOKE ALL ON FUNCTION public.admin_get_pillar_publish_readiness(text,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_pillar_publish_readiness(text,int) TO authenticated, service_role;

-- 4) Publish RPC (fail-soft, idempotent, audited)
CREATE OR REPLACE FUNCTION public.admin_publish_certification_pillars(
  p_limit   int     DEFAULT 25,
  p_dry_run boolean DEFAULT true,
  p_reason  text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cap        int := LEAST(GREATEST(COALESCE(p_limit,25),1), 200);
  v_attempted  int := 0;
  v_published  int := 0;
  v_skipped    int := 0;
  v_failed     int := 0;
  v_rec        record;
  v_started    timestamptz := now();
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF NOT p_dry_run AND (p_reason IS NULL OR length(trim(p_reason)) < 10) THEN
    RAISE EXCEPTION 'live publish requires p_reason of >=10 chars';
  END IF;

  FOR v_rec IN
    SELECT * FROM public.v_pillar_publish_readiness
    WHERE decision = 'READY_TO_PUBLISH'
    ORDER BY catalog_slug NULLS LAST
    LIMIT v_cap
  LOOP
    v_attempted := v_attempted + 1;
    BEGIN
      IF p_dry_run THEN
        v_published := v_published + 1;
      ELSE
        UPDATE public.certification_seo_pages
           SET is_published = true,
               published_at = COALESCE(published_at, now()),
               updated_at   = now()
         WHERE id = v_rec.pillar_id
           AND is_published IS NOT TRUE;
        IF FOUND THEN
          v_published := v_published + 1;
        ELSE
          v_skipped := v_skipped + 1;
          PERFORM public.fn_emit_audit(
            'pillar_publish_skipped','certification_seo_pages', v_rec.pillar_id::text,'skipped',
            jsonb_build_object('pillar_id', v_rec.pillar_id,'catalog_id', v_rec.catalog_id,
              'skip_reason','ALREADY_PUBLISHED_OR_NOOP','dry_run', p_dry_run),
            'admin_publish_certification_pillars');
          CONTINUE;
        END IF;
      END IF;

      PERFORM public.fn_emit_audit(
        'pillar_publish_attempt','certification_seo_pages', v_rec.pillar_id::text,'success',
        jsonb_build_object(
          'pillar_id', v_rec.pillar_id,
          'catalog_id', v_rec.catalog_id,
          'package_id', v_rec.package_id,
          'dry_run', p_dry_run,
          'reason', COALESCE(p_reason,'(dry_run)'),
          'quality_score', v_rec.quality_score,
          'outbound_links', v_rec.outbound_links),
        'admin_publish_certification_pillars');

    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      BEGIN
        PERFORM public.fn_emit_audit(
          'pillar_publish_skipped','certification_seo_pages', v_rec.pillar_id::text,'error',
          jsonb_build_object('pillar_id', v_rec.pillar_id,'catalog_id', v_rec.catalog_id,
            'skip_reason','EXCEPTION','dry_run', p_dry_run,'error', SQLERRM),
          'admin_publish_certification_pillars', SQLERRM);
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END;
  END LOOP;

  PERFORM public.fn_emit_audit(
    'pillar_publish_summary','system', NULL,
    CASE WHEN v_failed=0 THEN 'success' ELSE 'partial' END,
    jsonb_build_object('ran_at', v_started, 'dry_run', p_dry_run,
      'reason', COALESCE(p_reason,'(dry_run)'),
      'limit', v_cap, 'attempted', v_attempted,
      'published', v_published, 'skipped', v_skipped, 'failed', v_failed),
    'admin_publish_certification_pillars');

  RETURN jsonb_build_object(
    'ran_at', v_started, 'dry_run', p_dry_run,
    'limit', v_cap, 'attempted', v_attempted,
    'published', v_published, 'skipped', v_skipped, 'failed', v_failed);
END $$;

REVOKE ALL ON FUNCTION public.admin_publish_certification_pillars(int,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_publish_certification_pillars(int,boolean,text) TO authenticated, service_role;

-- Smoke (no-op safe; dry_run by default cannot be tested as admin from migration session)
DO $$ BEGIN
  RAISE NOTICE 'E3f-Publish-Gate v1 installed';
END $$;