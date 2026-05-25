-- E3e.5c — Cornerstone-Bridge activation RPC
-- Reuses seo_internal_link_suggestions (no new table) per BRIDGE_DONT_FORK / EXTEND_EXISTING.

INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES (
  'cornerstone_bridge_activated',
  ARRAY['min_score','dry_run','cornerstone_blogs','candidates','activated','skipped','correlation_id'],
  'seo.cornerstone'
)
ON CONFLICT (action_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_activate_cornerstone_bridge_suggestions(
  p_min_score numeric DEFAULT 0.60,
  p_dry_run boolean DEFAULT true,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_correlation uuid := gen_random_uuid();
  v_blogs int;
  v_candidates int;
  v_activated int := 0;
  v_skipped int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF p_dry_run = false AND (p_reason IS NULL OR length(btrim(p_reason)) < 5) THEN
    RAISE EXCEPTION 'reason required (min 5 chars) for live apply';
  END IF;

  WITH cs AS (
    SELECT blog_slug, cornerstone_score
    FROM public.v_cornerstone_blog_score
    WHERE cornerstone_score >= p_min_score
  )
  SELECT COUNT(*) INTO v_blogs FROM cs;

  WITH cs AS (
    SELECT blog_slug FROM public.v_cornerstone_blog_score WHERE cornerstone_score >= p_min_score
  ),
  cand AS (
    SELECT s.id
    FROM public.seo_internal_link_suggestions s
    JOIN cs ON s.source_url = '/blog/' || cs.blog_slug
    WHERE s.status = 'suggested'
      AND s.link_type IN ('blog_to_pillar','blog_to_exam_package')
  )
  SELECT COUNT(*) INTO v_candidates FROM cand;

  IF p_dry_run THEN
    v_skipped := v_candidates;
  ELSE
    WITH cs AS (
      SELECT blog_slug FROM public.v_cornerstone_blog_score WHERE cornerstone_score >= p_min_score
    ),
    upd AS (
      UPDATE public.seo_internal_link_suggestions s
      SET status = 'active', updated_at = now()
      FROM cs
      WHERE s.source_url = '/blog/' || cs.blog_slug
        AND s.status = 'suggested'
        AND s.link_type IN ('blog_to_pillar','blog_to_exam_package')
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_activated FROM upd;
  END IF;

  PERFORM public.fn_emit_audit(
    'cornerstone_bridge_activated',
    'system',
    NULL,
    CASE WHEN p_dry_run THEN 'noop'
         WHEN v_activated = 0 THEN 'noop'
         ELSE 'success' END,
    jsonb_build_object(
      'min_score', p_min_score,
      'dry_run', p_dry_run,
      'cornerstone_blogs', v_blogs,
      'candidates', v_candidates,
      'activated', v_activated,
      'skipped', v_skipped,
      'correlation_id', v_correlation,
      'reason', p_reason
    ),
    'admin_activate_cornerstone_bridge_suggestions',
    NULL
  );

  RETURN jsonb_build_object(
    'min_score', p_min_score,
    'dry_run', p_dry_run,
    'cornerstone_blogs', v_blogs,
    'candidates', v_candidates,
    'activated', v_activated,
    'skipped', v_skipped,
    'correlation_id', v_correlation
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_activate_cornerstone_bridge_suggestions(numeric, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_activate_cornerstone_bridge_suggestions(numeric, boolean, text) TO authenticated;