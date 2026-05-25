
-- 1) Public storage bucket for blog hero images
INSERT INTO storage.buckets (id, name, public) 
VALUES ('public-assets', 'public-assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "public read blog heroes" ON storage.objects;
CREATE POLICY "public read blog heroes" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'public-assets');

-- 2) Register job_types
INSERT INTO public.ops_job_type_registry (job_type, pool, lane, job_name, requires_package_id, is_active, description)
VALUES
  ('seo_blog_hero_generate', 'seo', 'growth', 'SEO Blog Hero Generate', false, true,
   'Generates hero image for a blog_article (Lovable AI Gemini image), uploads to public-assets/blog-heroes/, sets hero_image_url + hero_image_alt.'),
  ('seo_blog_anchor_section_generate', 'seo', 'growth', 'SEO Blog Anchor Section Generate', false, true,
   'Backfills internal_links_json for a blog_article (4-6 contextual links within same source_curriculum_id cluster).')
ON CONFLICT (job_type) DO UPDATE
  SET pool = EXCLUDED.pool, lane = EXCLUDED.lane, job_name = EXCLUDED.job_name,
      requires_package_id = EXCLUDED.requires_package_id, is_active = EXCLUDED.is_active,
      description = EXCLUDED.description;

-- 3) Audit contracts
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('cornerstone_enrichment_dispatched',
   ARRAY['snapshot_id','dims','dispatched','skipped','skip_reasons'],
   'admin_seo_cornerstone_enrich_dispatch'),
  ('seo_blog_hero_generated',
   ARRAY['blog_article_id','blog_slug','hero_image_url','model','duration_ms'],
   'seo-blog-hero-generate'),
  ('seo_blog_anchor_section_generated',
   ARRAY['blog_article_id','blog_slug','links_added','curriculum_id','duration_ms'],
   'seo-blog-anchor-section-generate')
ON CONFLICT (action_type) DO UPDATE
  SET required_keys = EXCLUDED.required_keys, owner_module = EXCLUDED.owner_module;

-- 4) Dispatch RPC: fan-out 1 job per (blog × dim) with idempotency
CREATE OR REPLACE FUNCTION public.admin_seo_cornerstone_enrich_dispatch(
  _snapshot_id uuid DEFAULT NULL,
  _dims text[] DEFAULT ARRAY['hero','anchor'],
  _limit_n int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_snapshot uuid;
  v_dispatched int := 0;
  v_skipped int := 0;
  v_skip_reasons jsonb := '{}'::jsonb;
  v_row record;
  v_dim text;
  v_job_type text;
  v_correlation text;
  v_exists boolean;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Resolve snapshot: explicit, else latest
  IF _snapshot_id IS NOT NULL THEN
    v_snapshot := _snapshot_id;
  ELSE
    SELECT snapshot_id INTO v_snapshot
    FROM public.seo_cornerstone_enrichment_targets
    ORDER BY snapshotted_at DESC LIMIT 1;
  END IF;

  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'no_snapshot_available';
  END IF;

  FOR v_row IN
    SELECT t.blog_article_id, t.blog_slug, t.gap_dimensions
    FROM public.seo_cornerstone_enrichment_targets t
    WHERE t.snapshot_id = v_snapshot
    ORDER BY t.rank
    LIMIT _limit_n
  LOOP
    FOREACH v_dim IN ARRAY _dims LOOP
      -- only enqueue if dim is actually a gap for this blog
      IF NOT (v_row.gap_dimensions ? v_dim) THEN
        v_skipped := v_skipped + 1;
        v_skip_reasons := jsonb_set(v_skip_reasons,
          ARRAY['not_a_gap'],
          to_jsonb(COALESCE((v_skip_reasons->>'not_a_gap')::int, 0) + 1));
        CONTINUE;
      END IF;

      v_job_type := CASE v_dim
        WHEN 'hero'   THEN 'seo_blog_hero_generate'
        WHEN 'anchor' THEN 'seo_blog_anchor_section_generate'
        ELSE NULL
      END;

      IF v_job_type IS NULL THEN
        v_skipped := v_skipped + 1;
        v_skip_reasons := jsonb_set(v_skip_reasons,
          ARRAY['unsupported_dim'],
          to_jsonb(COALESCE((v_skip_reasons->>'unsupported_dim')::int, 0) + 1));
        CONTINUE;
      END IF;

      v_correlation := format('cornerstone_enrich|%s|%s', v_row.blog_article_id, v_dim);

      SELECT EXISTS(
        SELECT 1 FROM public.job_queue
        WHERE correlation_id = v_correlation
          AND status IN ('pending','processing')
      ) INTO v_exists;

      IF v_exists THEN
        v_skipped := v_skipped + 1;
        v_skip_reasons := jsonb_set(v_skip_reasons,
          ARRAY['already_active'],
          to_jsonb(COALESCE((v_skip_reasons->>'already_active')::int, 0) + 1));
        CONTINUE;
      END IF;

      INSERT INTO public.job_queue (job_type, payload, status, worker_pool, correlation_id, job_name)
      VALUES (
        v_job_type,
        jsonb_build_object(
          'blog_article_id', v_row.blog_article_id,
          'blog_slug', v_row.blog_slug,
          'snapshot_id', v_snapshot,
          '_origin', 'cornerstone_enrichment_dispatch'
        ),
        'pending',
        'seo',
        v_correlation,
        v_job_type
      );
      v_dispatched := v_dispatched + 1;
    END LOOP;
  END LOOP;

  PERFORM public.fn_emit_audit(
    'cornerstone_enrichment_dispatched',
    'system',
    v_snapshot::text,
    CASE WHEN v_dispatched > 0 THEN 'success' ELSE 'noop' END,
    jsonb_build_object(
      'snapshot_id', v_snapshot,
      'dims', _dims,
      'dispatched', v_dispatched,
      'skipped', v_skipped,
      'skip_reasons', v_skip_reasons,
      'limit_n', _limit_n
    ),
    'admin_seo_cornerstone_enrich_dispatch',
    format('Dispatched %s, skipped %s', v_dispatched, v_skipped)
  );

  RETURN jsonb_build_object(
    'snapshot_id', v_snapshot,
    'dispatched', v_dispatched,
    'skipped', v_skipped,
    'skip_reasons', v_skip_reasons
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_seo_cornerstone_enrich_dispatch(uuid, text[], int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_seo_cornerstone_enrich_dispatch(uuid, text[], int) TO authenticated;
