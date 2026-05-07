-- Phase 3: Keyword Registry <-> Content Graph Sync Check (read-only)
CREATE OR REPLACE FUNCTION public.admin_check_keyword_graph_sync()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_nodes_with_kw int := 0;
  v_keywords_registered int := 0;
  v_missing_registry int := 0;
  v_owner_mismatch int := 0;
  v_duplicate_active int := 0;
  v_ok int := 0;
  v_missing_samples jsonb;
  v_mismatch_samples jsonb;
  v_duplicate_samples jsonb;
BEGIN
  SELECT public.has_role(auth.uid(), 'admin'::app_role) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT COUNT(*) INTO v_nodes_with_kw
  FROM public.growth_content_graph_nodes
  WHERE keyword_slug IS NOT NULL AND keyword_slug <> '';

  SELECT COUNT(*) INTO v_keywords_registered
  FROM public.growth_keyword_registry
  WHERE status = 'active';

  -- Missing in registry
  SELECT COUNT(*) INTO v_missing_registry
  FROM public.growth_content_graph_nodes n
  WHERE n.keyword_slug IS NOT NULL AND n.keyword_slug <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.growth_keyword_registry r
      WHERE r.keyword_slug = n.keyword_slug AND r.status = 'active'
    );

  -- Owner mismatch: registered active but owner_id != node_id (or owner_url drift)
  SELECT COUNT(*) INTO v_owner_mismatch
  FROM public.growth_content_graph_nodes n
  JOIN public.growth_keyword_registry r
    ON r.keyword_slug = n.keyword_slug AND r.status = 'active'
  WHERE n.keyword_slug IS NOT NULL AND n.keyword_slug <> ''
    AND r.owner_id IS DISTINCT FROM n.id;

  -- Duplicate active owners (should be impossible due to unique idx, but verify)
  SELECT COUNT(*) INTO v_duplicate_active
  FROM (
    SELECT keyword_slug
    FROM public.growth_keyword_registry
    WHERE status = 'active'
    GROUP BY keyword_slug
    HAVING COUNT(*) > 1
  ) d;

  v_ok := GREATEST(v_nodes_with_kw - v_missing_registry - v_owner_mismatch, 0);

  -- Samples (top 10 each)
  SELECT COALESCE(jsonb_agg(s), '[]'::jsonb) INTO v_missing_samples FROM (
    SELECT n.id AS node_id, n.node_slug, n.keyword_slug, n.asset_type, n.persona
    FROM public.growth_content_graph_nodes n
    WHERE n.keyword_slug IS NOT NULL AND n.keyword_slug <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.growth_keyword_registry r
        WHERE r.keyword_slug = n.keyword_slug AND r.status = 'active'
      )
    ORDER BY n.created_at DESC
    LIMIT 10
  ) s;

  SELECT COALESCE(jsonb_agg(s), '[]'::jsonb) INTO v_mismatch_samples FROM (
    SELECT n.id AS node_id, n.node_slug, n.keyword_slug,
           r.owner_id AS registry_owner_id, r.owner_url AS registry_owner_url
    FROM public.growth_content_graph_nodes n
    JOIN public.growth_keyword_registry r
      ON r.keyword_slug = n.keyword_slug AND r.status = 'active'
    WHERE r.owner_id IS DISTINCT FROM n.id
    ORDER BY n.updated_at DESC
    LIMIT 10
  ) s;

  SELECT COALESCE(jsonb_agg(s), '[]'::jsonb) INTO v_duplicate_samples FROM (
    SELECT keyword_slug, COUNT(*) AS active_count
    FROM public.growth_keyword_registry
    WHERE status = 'active'
    GROUP BY keyword_slug
    HAVING COUNT(*) > 1
    ORDER BY active_count DESC
    LIMIT 10
  ) s;

  RETURN jsonb_build_object(
    'metrics', jsonb_build_object(
      'nodes_with_keyword_slug', v_nodes_with_kw,
      'keywords_registered', v_keywords_registered,
      'missing_keyword_registry', v_missing_registry,
      'keyword_owner_mismatch', v_owner_mismatch,
      'duplicate_active_keyword_owner', v_duplicate_active,
      'ok_count', v_ok
    ),
    'samples', jsonb_build_object(
      'missing_registry', v_missing_samples,
      'owner_mismatch', v_mismatch_samples,
      'duplicate_active', v_duplicate_samples
    ),
    'computed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_check_keyword_graph_sync() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_check_keyword_graph_sync() TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_check_keyword_graph_sync() IS
  'Phase 3: Read-only sync check between growth_content_graph_nodes.keyword_slug and growth_keyword_registry. Returns metrics + samples. Admin-only. No writes.';