
-- ════════════════════════════════════════════════════════════════════════
-- E3d: Pillar↔Package Coverage Gate + SEO Dead-End Guard
-- ════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public.v_seo_dead_end_coverage CASCADE;

CREATE VIEW public.v_seo_dead_end_coverage AS
WITH pub_pkg AS (
  SELECT
    cp.id              AS package_id,
    cp.certification_id,
    cp.curriculum_id,
    cp.title           AS package_title,
    cp.product_id      AS pkg_product_id
  FROM public.course_packages cp
  WHERE cp.status = 'published'
),
prod AS (
  SELECT
    p.id              AS product_id,
    p.slug            AS product_slug,
    p.status          AS product_status,
    p.visibility,
    p.certification_id
  FROM public.products p
),
pkg_prod AS (
  SELECT
    pp.package_id,
    pp.certification_id,
    pp.curriculum_id,
    pp.package_title,
    COALESCE(pp.pkg_product_id, pr1.product_id, pr2.product_id) AS product_id,
    COALESCE(pr1.product_slug, pr2.product_slug)                 AS product_slug,
    COALESCE(pr1.product_status, pr2.product_status)             AS product_status,
    COALESCE(pr1.visibility, pr2.visibility)                     AS product_visibility
  FROM pub_pkg pp
  LEFT JOIN prod pr1 ON pr1.product_id = pp.pkg_product_id
  LEFT JOIN prod pr2 ON pr2.certification_id = pp.certification_id
                    AND pr2.product_status = 'active'
                    AND pp.pkg_product_id IS NULL
),
cat AS (
  SELECT
    cc.id                     AS catalog_id,
    cc.linked_certification_id,
    cc.slug                   AS catalog_slug
  FROM public.certification_catalog cc
),
pillar AS (
  SELECT
    csp.id                AS pillar_id,
    csp.certification_catalog_id,
    csp.is_published      AS pillar_published,
    csp.slug              AS pillar_slug,
    csp.product_slug_override
  FROM public.certification_seo_pages csp
  WHERE csp.page_type = 'landing'
),
pkg_pillar AS (
  SELECT
    pp.package_id,
    c.catalog_id,
    pi.pillar_id,
    pi.pillar_published,
    pi.pillar_slug,
    pi.product_slug_override
  FROM pkg_prod pp
  LEFT JOIN cat c   ON c.linked_certification_id = pp.certification_id
  LEFT JOIN pillar pi ON pi.certification_catalog_id = c.catalog_id
),
spokes AS (
  SELECT
    package_id,
    COUNT(*)                                            AS spokes_total,
    COUNT(*) FILTER (WHERE status = 'published')        AS spokes_published
  FROM public.seo_content_pages
  WHERE package_id IS NOT NULL
  GROUP BY package_id
),
blog_docs AS (
  SELECT
    curriculum_id,
    COUNT(*) FILTER (WHERE doc_type IN ('blog','faq'))                                  AS blog_total,
    COUNT(*) FILTER (WHERE doc_type IN ('blog','faq') AND status = 'published')         AS blog_published
  FROM public.seo_documents
  WHERE curriculum_id IS NOT NULL
  GROUP BY curriculum_id
),
ils AS (
  SELECT
    target_url,
    COUNT(*) FILTER (WHERE status = 'active')    AS links_active,
    COUNT(*) FILTER (WHERE status = 'suggested') AS links_suggested
  FROM public.seo_internal_link_suggestions
  GROUP BY target_url
),
base AS (
  SELECT
    pp.package_id,
    pp.package_title,
    pp.certification_id,
    pp.curriculum_id,
    pp.product_id,
    pp.product_slug,
    pp.product_status,
    pp.product_visibility,
    pk.catalog_id,
    pk.pillar_id,
    pk.pillar_published,
    pk.pillar_slug,
    COALESCE(s.spokes_total, 0)        AS spokes_total,
    COALESCE(s.spokes_published, 0)    AS spokes_published,
    COALESCE(bd.blog_total, 0)         AS blog_total,
    COALESCE(bd.blog_published, 0)     AS blog_published,
    COALESCE(il.links_active, 0)       AS links_active,
    COALESCE(il.links_suggested, 0)    AS links_suggested
  FROM pkg_prod pp
  LEFT JOIN pkg_pillar pk ON pk.package_id = pp.package_id
  LEFT JOIN spokes s      ON s.package_id  = pp.package_id
  LEFT JOIN blog_docs bd  ON bd.curriculum_id = pp.curriculum_id
  LEFT JOIN ils il        ON il.target_url = '/p/' || COALESCE(pp.product_slug, '')
)
SELECT
  b.*,
  CASE
    WHEN b.product_id IS NULL OR b.product_status <> 'active' THEN 'NO_PRODUCT_PAGE'
    WHEN b.catalog_id IS NULL                                 THEN 'NO_PILLAR'
    WHEN b.pillar_id IS NULL                                  THEN 'PILLAR_NOT_LINKED_TO_PACKAGE'
    WHEN b.pillar_published IS NOT TRUE                       THEN 'PILLAR_NOT_PUBLISHED'
    WHEN b.spokes_total = 0                                   THEN 'NO_SPOKES'
    WHEN b.spokes_published = 0                               THEN 'SPOKES_NOT_PUBLISHED'
    WHEN b.blog_total > 0 AND b.blog_published = 0            THEN 'BLOG_CONTEXTUAL_LINKS_BLOCKED'
    WHEN b.links_active = 0                                   THEN 'INTERNAL_LINKS_MISSING'
    ELSE 'OK'
  END AS status,
  CASE
    WHEN (b.product_id IS NULL OR b.product_status <> 'active')
      OR b.catalog_id IS NULL
      OR b.pillar_id IS NULL
      OR b.pillar_published IS NOT TRUE
      THEN TRUE
    ELSE FALSE
  END AS is_seo_dead_end,
  CASE
    WHEN b.product_id IS NULL OR b.product_status <> 'active' THEN 'Product page missing or not active'
    WHEN b.catalog_id IS NULL                                 THEN 'No catalog entry mapped to package certification'
    WHEN b.pillar_id IS NULL                                  THEN 'Catalog mapped, but no SEO pillar page exists'
    WHEN b.pillar_published IS NOT TRUE                       THEN 'Pillar page exists but is not published'
    WHEN b.spokes_total = 0                                   THEN 'No SEO spoke content pages for this package'
    WHEN b.spokes_published = 0                               THEN 'Spokes exist but none are published'
    WHEN b.blog_total > 0 AND b.blog_published = 0            THEN 'Blog/FAQ docs exist but none are published — contextual links cannot materialize'
    WHEN b.links_active = 0                                   THEN 'No active internal link points at this product URL'
    ELSE 'OK'
  END AS blocking_reason,
  CASE
    WHEN b.product_id IS NULL OR b.product_status <> 'active' THEN 'Activate product page for this certification'
    WHEN b.catalog_id IS NULL                                 THEN 'Run E3b.2/E3b.3 mapping or create catalog entry'
    WHEN b.pillar_id IS NULL                                  THEN 'Generate certification_seo_pages landing for this catalog'
    WHEN b.pillar_published IS NOT TRUE                       THEN 'Publish pillar (set is_published=true)'
    WHEN b.spokes_total = 0                                   THEN 'Enqueue seo_intent_page_generate via E3a/E3c pipeline'
    WHEN b.spokes_published = 0                               THEN 'Promote spokes to status=published'
    WHEN b.blog_total > 0 AND b.blog_published = 0            THEN 'Run E3e blog publishing convergence (next cut)'
    WHEN b.links_active = 0                                   THEN 'Run admin_materialize_internal_links (E3c)'
    ELSE 'No action'
  END AS recommended_next_action
FROM base b;

COMMENT ON VIEW public.v_seo_dead_end_coverage IS
'E3d SSOT — Pillar↔Package coverage classification for published packages. Read-only.';

REVOKE ALL ON public.v_seo_dead_end_coverage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_seo_dead_end_coverage TO service_role;

-- ──────────────────────────────────────────────────────────────────
-- 2) Admin-gated RPC
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_seo_dead_end_coverage(
  p_status text  DEFAULT NULL,
  p_limit  int   DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_summary jsonb;
  v_rows jsonb;
BEGIN
  IF NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'access_denied: admin role required';
  END IF;

  SELECT jsonb_build_object(
    'total_published_packages', COUNT(*),
    'ok_count',                 COUNT(*) FILTER (WHERE status = 'OK'),
    'dead_end_count',           COUNT(*) FILTER (WHERE is_seo_dead_end),
    'by_status',                (
       SELECT jsonb_object_agg(status, c)
       FROM (
         SELECT status, COUNT(*) AS c
         FROM public.v_seo_dead_end_coverage
         GROUP BY status
       ) z
    )
  )
  INTO v_summary
  FROM public.v_seo_dead_end_coverage;

  SELECT jsonb_agg(to_jsonb(r))
  INTO v_rows
  FROM (
    SELECT *
    FROM public.v_seo_dead_end_coverage
    WHERE (p_status IS NULL OR status = p_status)
    ORDER BY (is_seo_dead_end)::int DESC, status, package_title
    LIMIT v_limit
  ) r;

  PERFORM public.fn_emit_audit(
    'seo_dead_end_coverage_detected',
    'system',
    NULL,
    'ok',
    jsonb_build_object(
      'actor', v_uid,
      'status_filter', p_status,
      'limit', v_limit,
      'summary', v_summary
    ),
    NULL,
    NULL
  );

  RETURN jsonb_build_object(
    'summary', v_summary,
    'rows', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_seo_dead_end_coverage(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_seo_dead_end_coverage(text, int) TO authenticated, service_role;

-- ──────────────────────────────────────────────────────────────────
-- 3) Fail-soft guard trigger on certification_seo_pages publish
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_guard_seo_pillar_publish_dead_end()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg record;
  v_dead boolean := false;
  v_reason text;
BEGIN
  IF NEW.is_published IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_published IS TRUE THEN
    RETURN NEW;
  END IF;

  SELECT cp.id AS package_id, cp.title, p.id AS product_id, p.status AS product_status
  INTO v_pkg
  FROM public.certification_catalog cc
  JOIN public.course_packages cp ON cp.certification_id = cc.linked_certification_id
                                 AND cp.status = 'published'
  LEFT JOIN public.products p     ON p.id = cp.product_id
  WHERE cc.id = NEW.certification_catalog_id
  LIMIT 1;

  IF v_pkg.package_id IS NULL THEN
    v_dead := true;
    v_reason := 'PILLAR_NOT_LINKED_TO_PACKAGE';
  ELSIF v_pkg.product_id IS NULL OR v_pkg.product_status <> 'active' THEN
    v_dead := true;
    v_reason := 'NO_PRODUCT_PAGE';
  END IF;

  IF v_dead THEN
    BEGIN
      PERFORM public.fn_emit_audit(
        'seo_dead_end_guard_detected',
        'system',
        v_pkg.package_id,
        'warn',
        jsonb_build_object(
          'pillar_id', NEW.id,
          'catalog_id', NEW.certification_catalog_id,
          'package_id', v_pkg.package_id,
          'reason', v_reason,
          'fail_soft', true
        ),
        NULL,
        NULL
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  ELSE
    BEGIN
      PERFORM public.fn_emit_audit(
        'seo_dead_end_guard_skipped',
        'system',
        v_pkg.package_id,
        'ok',
        jsonb_build_object(
          'pillar_id', NEW.id,
          'catalog_id', NEW.certification_catalog_id,
          'reason', 'pillar_publish_clean'
        ),
        NULL,
        NULL
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_seo_pillar_publish_dead_end ON public.certification_seo_pages;
CREATE TRIGGER trg_guard_seo_pillar_publish_dead_end
BEFORE INSERT OR UPDATE OF is_published ON public.certification_seo_pages
FOR EACH ROW
EXECUTE FUNCTION public.fn_guard_seo_pillar_publish_dead_end();

-- ──────────────────────────────────────────────────────────────────
-- 4) Audit contracts
-- ──────────────────────────────────────────────────────────────────
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('seo_dead_end_coverage_detected',  ARRAY['summary','limit']::text[],                  'e3d_seo_dead_end_guard'),
  ('seo_dead_end_guard_detected',     ARRAY['pillar_id','catalog_id','reason']::text[],  'e3d_seo_dead_end_guard'),
  ('seo_dead_end_guard_skipped',      ARRAY['pillar_id','catalog_id','reason']::text[],  'e3d_seo_dead_end_guard'),
  ('seo_dead_end_repair_recommended', ARRAY['package_id','reason']::text[],              'e3d_seo_dead_end_guard')
ON CONFLICT (action_type) DO UPDATE
  SET required_keys = EXCLUDED.required_keys,
      owner_module  = EXCLUDED.owner_module,
      updated_at    = now();
