-- Phase 2C: Content Graph Backfill (Dry-Run-first)

CREATE OR REPLACE FUNCTION public.admin_preview_content_graph_backfill()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  WITH
  blog AS (
    SELECT
      'blog/'||slug AS node_slug, title, 'blog'::text AS asset_type, 'blog'::text AS owner_kind,
      id AS owner_id, slug, status
    FROM public.blog_articles
  ),
  seo AS (
    SELECT
      'seo/'||slug AS node_slug, title, 'landing'::text AS asset_type, 'seo_page'::text AS owner_kind,
      id AS owner_id, slug, status
    FROM public.seo_content_pages
  ),
  cert AS (
    SELECT
      'cert/'||slug AS node_slug, title, 'landing'::text AS asset_type, 'seo_page'::text AS owner_kind,
      id AS owner_id, slug, CASE WHEN is_published THEN 'published' ELSE 'draft' END AS status
    FROM public.certification_seo_pages
  ),
  prod AS (
    SELECT
      'product-landing/'||id::text AS node_slug,
      COALESCE(hero_headline, seo_title, 'Product Landing '||id::text) AS title,
      'product'::text AS asset_type, 'product_page'::text AS owner_kind,
      id AS owner_id, NULL::text AS slug,
      CASE WHEN active THEN 'active' ELSE 'inactive' END AS status
    FROM public.product_landing_profiles
  ),
  unioned AS (
    SELECT 'blog_articles' AS source, * FROM blog
    UNION ALL SELECT 'seo_content_pages', * FROM seo
    UNION ALL SELECT 'certification_seo_pages', * FROM cert
    UNION ALL SELECT 'product_landing_profiles', * FROM prod
  ),
  classified AS (
    SELECT
      u.*,
      (u.node_slug IS NULL OR length(trim(u.node_slug))=0
        OR u.title IS NULL OR length(trim(u.title))=0
        OR u.node_slug IN ('blog/','seo/','cert/')) AS is_invalid,
      EXISTS (
        SELECT 1 FROM public.growth_content_graph_nodes n WHERE n.node_slug = u.node_slug
      ) AS exists_already
    FROM unioned u
  ),
  per_source AS (
    SELECT
      source,
      count(*) AS candidates_total,
      count(*) FILTER (WHERE is_invalid) AS invalid_count,
      count(*) FILTER (WHERE NOT is_invalid AND exists_already) AS existing_count,
      count(*) FILTER (WHERE NOT is_invalid AND NOT exists_already) AS new_count
    FROM classified
    GROUP BY source
  ),
  totals AS (
    SELECT
      count(*) AS candidates_total,
      count(*) FILTER (WHERE is_invalid) AS invalid_count,
      count(*) FILTER (WHERE NOT is_invalid AND exists_already) AS existing_count,
      count(*) FILTER (WHERE NOT is_invalid AND NOT exists_already) AS new_count
    FROM classified
  ),
  sample AS (
    SELECT source, node_slug, title, asset_type, owner_kind, owner_id, exists_already, is_invalid
    FROM classified
    WHERE NOT is_invalid AND NOT exists_already
    ORDER BY source, node_slug
    LIMIT 25
  )
  SELECT jsonb_build_object(
    'totals', (SELECT to_jsonb(t) FROM totals t),
    'per_source', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.source) FROM per_source p), '[]'::jsonb),
    'sample', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM sample s), '[]'::jsonb),
    'generated_at', now()
  )
  INTO v_result;

  RETURN v_result;
END $function$;

REVOKE ALL ON FUNCTION public.admin_preview_content_graph_backfill() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_preview_content_graph_backfill() TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.admin_run_content_graph_backfill(
  p_limit int DEFAULT 50,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted int := 0;
  v_updated  int := 0;
  v_skipped  int := 0;
  v_invalid  int := 0;
  v_processed int := 0;
  v_source_counts jsonb := '{}'::jsonb;
  r record;
  v_existing uuid;
  v_action text;
  v_per_src jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 1000';
  END IF;

  FOR r IN
    WITH
    blog AS (
      SELECT 'blog_articles' AS source, 'blog/'||slug AS node_slug, title,
             'blog'::text AS asset_type, 'blog'::text AS owner_kind, id AS owner_id,
             jsonb_build_object('source','blog_articles','source_id',id,'source_slug',slug,'source_status',status) AS metadata,
             canonical_url
      FROM public.blog_articles
    ),
    seo AS (
      SELECT 'seo_content_pages', 'seo/'||slug, title, 'landing','seo_page', id,
             jsonb_build_object('source','seo_content_pages','source_id',id,'source_slug',slug,'source_status',status),
             NULL::text
      FROM public.seo_content_pages
    ),
    cert AS (
      SELECT 'certification_seo_pages', 'cert/'||slug, title, 'landing','seo_page', id,
             jsonb_build_object('source','certification_seo_pages','source_id',id,'source_slug',slug,'page_type',page_type,'is_published',is_published),
             NULL::text
      FROM public.certification_seo_pages
    ),
    prod AS (
      SELECT 'product_landing_profiles', 'product-landing/'||id::text,
             COALESCE(hero_headline, seo_title, 'Product Landing '||id::text),
             'product','product_page', id,
             jsonb_build_object('source','product_landing_profiles','source_id',id,'landing_type',landing_type,'certification_id',certification_id,'active',active),
             NULL::text
      FROM public.product_landing_profiles
    ),
    unioned AS (
      SELECT * FROM blog
      UNION ALL SELECT * FROM seo
      UNION ALL SELECT * FROM cert
      UNION ALL SELECT * FROM prod
    )
    SELECT * FROM unioned
    ORDER BY source, node_slug
  LOOP
    EXIT WHEN v_processed >= p_limit;

    -- invalid?
    IF r.node_slug IS NULL OR length(trim(r.node_slug))=0
       OR r.title IS NULL OR length(trim(r.title))=0
       OR r.node_slug IN ('blog/','seo/','cert/') THEN
      v_invalid := v_invalid + 1;
      CONTINUE;
    END IF;

    SELECT id INTO v_existing
    FROM public.growth_content_graph_nodes
    WHERE node_slug = r.node_slug
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
      v_action := 'skipped_existing';
      v_skipped := v_skipped + 1;
    ELSE
      v_action := 'inserted';
      v_inserted := v_inserted + 1;
      IF NOT p_dry_run THEN
        INSERT INTO public.growth_content_graph_nodes(
          node_slug, title, asset_type, owner_kind, owner_id,
          canonical_url, metadata, status, created_by
        ) VALUES (
          r.node_slug, r.title, r.asset_type, r.owner_kind, r.owner_id,
          r.canonical_url, r.metadata, 'draft'::public.growth_node_status, auth.uid()
        );
      END IF;
    END IF;

    -- per-source counter
    v_per_src := COALESCE(v_source_counts -> r.source, '{"inserted":0,"skipped":0,"invalid":0}'::jsonb);
    IF v_action = 'inserted' THEN
      v_per_src := jsonb_set(v_per_src, '{inserted}', to_jsonb((v_per_src->>'inserted')::int + 1));
    ELSE
      v_per_src := jsonb_set(v_per_src, '{skipped}', to_jsonb((v_per_src->>'skipped')::int + 1));
    END IF;
    v_source_counts := jsonb_set(v_source_counts, ARRAY[r.source], v_per_src, true);

    v_processed := v_processed + 1;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'growth_content_graph_backfill', 'system', NULL, 'success',
    jsonb_build_object(
      'dry_run', p_dry_run,
      'limit', p_limit,
      'processed', v_processed,
      'inserted', CASE WHEN p_dry_run THEN 0 ELSE v_inserted END,
      'would_insert', v_inserted,
      'skipped_existing', v_skipped,
      'invalid', v_invalid,
      'per_source', v_source_counts
    )
  );

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'limit', p_limit,
    'processed', v_processed,
    'inserted', CASE WHEN p_dry_run THEN 0 ELSE v_inserted END,
    'would_insert', v_inserted,
    'skipped_existing', v_skipped,
    'invalid', v_invalid,
    'per_source', v_source_counts
  );
END $function$;

REVOKE ALL ON FUNCTION public.admin_run_content_graph_backfill(int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_run_content_graph_backfill(int, boolean) TO authenticated, service_role;