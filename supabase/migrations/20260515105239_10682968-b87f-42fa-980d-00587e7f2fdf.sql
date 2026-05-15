-- Re-grant public Pillar RPC to anon/authenticated (lost between migrations)
GRANT EXECUTE ON FUNCTION public.get_published_pillar_page(text) TO anon, authenticated, service_role;

-- Raise Pillar candidate threshold to >= 6 (matches Hard-QC internal_links >= 6)
CREATE OR REPLACE FUNCTION public.admin_get_pillar_candidates()
RETURNS TABLE(
  curriculum_id uuid,
  curriculum_title text,
  curriculum_slug text,
  package_id uuid,
  package_key text,
  spoke_count bigint,
  has_pillar boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'permission denied: admin role required';
  END IF;

  RETURN QUERY
  WITH spokes AS (
    SELECT scp.curriculum_id, COUNT(*)::bigint AS cnt
    FROM public.seo_content_pages scp
    WHERE scp.page_type = 'intent_page'
      AND scp.status = 'published'
      AND scp.quality_score >= 80
    GROUP BY scp.curriculum_id
  ),
  pillars AS (
    SELECT DISTINCT scp.curriculum_id
    FROM public.seo_content_pages scp
    WHERE scp.page_type = 'pillar_page' AND scp.status = 'published'
  )
  SELECT c.id, c.title,
         public.fn_normalize_curriculum_slug(c.title),
         cp.id, cp.package_key, s.cnt,
         (p.curriculum_id IS NOT NULL)
  FROM spokes s
  JOIN public.curricula c ON c.id = s.curriculum_id
  LEFT JOIN public.course_packages cp ON cp.curriculum_id = c.id AND cp.status = 'published'
  LEFT JOIN pillars p ON p.curriculum_id = s.curriculum_id
  WHERE s.cnt >= 6
  ORDER BY s.cnt DESC;
END;
$function$;

-- Spoke → Pillar internal-link upserter (idempotent, rejected-safe)
CREATE OR REPLACE FUNCTION public.admin_seo_link_spokes_to_pillar(p_curriculum_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_slug text;
  v_title text;
  v_target text;
  v_pillar_exists boolean;
  v_upserted int := 0;
  v_skipped_rejected int := 0;
  v_total_spokes int := 0;
  rec record;
BEGIN
  SELECT public.fn_normalize_curriculum_slug(c.title), c.title
    INTO v_slug, v_title
  FROM public.curricula c WHERE c.id = p_curriculum_id;
  IF v_slug IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'curriculum_not_found');
  END IF;

  v_target := '/kurse/' || v_slug;

  SELECT EXISTS (
    SELECT 1 FROM public.seo_content_pages
    WHERE curriculum_id = p_curriculum_id
      AND page_type = 'pillar_page'
      AND status = 'published'
      AND quality_score >= 80
  ) INTO v_pillar_exists;

  IF NOT v_pillar_exists THEN
    RETURN jsonb_build_object('ok', false, 'error', 'pillar_not_published', 'curriculum_id', p_curriculum_id);
  END IF;

  FOR rec IN
    SELECT scp.id, scp.slug, scp.title
    FROM public.seo_content_pages scp
    WHERE scp.curriculum_id = p_curriculum_id
      AND scp.page_type = 'intent_page'
      AND scp.status = 'published'
      AND scp.quality_score >= 80
  LOOP
    v_total_spokes := v_total_spokes + 1;

    -- Never auto-revive rejected
    IF EXISTS (
      SELECT 1 FROM public.seo_internal_link_suggestions
      WHERE source_url = '/kurse/' || rec.slug
        AND target_url = v_target
        AND link_type  = 'cluster_to_pillar'
        AND status     = 'rejected'
    ) THEN
      v_skipped_rejected := v_skipped_rejected + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.seo_internal_link_suggestions(
      source_url, source_title, target_url, target_title,
      anchor_text, link_type, relevance_score, priority,
      reason, status, source_doc_id
    ) VALUES (
      '/kurse/' || rec.slug,
      rec.title,
      v_target,
      v_title,
      v_title,
      'cluster_to_pillar',
      90, 5,
      'auto:pillar-spoke-linker',
      'active',
      NULL
    )
    ON CONFLICT (source_url, target_url, link_type)
    DO UPDATE SET status = 'active', updated_at = now(),
                  anchor_text = EXCLUDED.anchor_text,
                  source_title = EXCLUDED.source_title,
                  target_title = EXCLUDED.target_title;
    v_upserted := v_upserted + 1;
  END LOOP;

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'seo_pillar_spoke_linker_run', 'curriculum', p_curriculum_id, 'ok',
    jsonb_build_object(
      'pillar_target', v_target,
      'spokes_total', v_total_spokes,
      'upserted', v_upserted,
      'skipped_rejected', v_skipped_rejected,
      'at', now()
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'pillar_target', v_target,
    'spokes_total', v_total_spokes,
    'upserted', v_upserted,
    'skipped_rejected', v_skipped_rejected
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_seo_link_spokes_to_pillar(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_seo_link_spokes_to_pillar(uuid) TO service_role;

INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'pillar_foundation_v1_1_hardening', 'system', 'ok',
  jsonb_build_object(
    'note', 'Pillar candidate threshold raised to >=6 spokes (matches Hard-QC). get_published_pillar_page re-granted to anon/authenticated. New RPC admin_seo_link_spokes_to_pillar (cluster_to_pillar SSOT-Write).',
    'at', now()
  )
);